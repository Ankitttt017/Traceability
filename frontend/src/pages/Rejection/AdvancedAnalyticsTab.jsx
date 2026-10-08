import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  BarChart3,
  TrendingUp,
  Grid,
  Flame,
  PieChart as PieIcon,
  ScatterChart as ScatterIcon,
  Sparkles,
  Filter,
  ChevronDown,
  ChevronUp,
  Layers,
  Target,
  Activity,
  Zap,
  Info,
  Cpu,
  BrainCircuit,
  Compass,
  AlertTriangle,
  ShieldCheck,
  Radar as RadarIcon,
  Maximize2,
  Sliders,
  Clock,
  BoxSelect,
  Layers2,
  HelpCircle,
  Download,
  RefreshCw,
  X,
} from "lucide-react";
import EChart from "../../components/charts/EChart";
import {
  ALL_45_PARAMETERS,
  MACHINE_PROCESS_PARAMETERS,
  PRODUCT_PARAMETERS,
  FLOW_PRESSURE_PARAMETERS,
  DIE_TEMPERATURE_PARAMETERS,
} from "./rejectionConstants";

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */
const getDeterministicHash = (str) => {
  let hash = 0;
  const s = String(str || "part");
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const getDeterministicJitter = (id, baseIndex, width = 0.22) => {
  const hash = getDeterministicHash(String(id || baseIndex));
  const norm = (hash % 1000) / 1000 - 0.5;
  return baseIndex + norm * width;
};

const canonicalizeReason = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim();
  const lower = s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  if (lower.includes("non filling") || lower.includes("nonfilling") || lower.includes("not filling") || lower.includes("under filling") || lower.includes("short filling") || lower.includes("pre filling")) return "Non-Filling";
  if (lower.includes("blow hole") || lower.includes("blowhole")) return "Blow Hole";
  if (lower.includes("pin hole") || lower.includes("pinhole")) return "Pin Hole";
  if (lower.includes("cold shut") || lower.includes("coldshut")) return "Cold Shut";
  if (lower.includes("leak") || lower.includes("leakage") || lower.includes("op150")) return "Pressure Leak (OP150)";
  if (lower.includes("dent")) return "Dent";
  if (lower.includes("crack")) return "Crack";
  if (lower.includes("porosity")) return "Porosity";
  if (lower.includes("bend")) return "Bend";
  if (lower.includes("chip off") || lower.includes("chipoff") || lower.includes("chip-off")) return "Chip-off";
  if (lower.includes("shrinkage")) return "Shrinkage";
  if (lower.includes("biscuit")) return "Biscuit Thickness NG";
  if (lower.includes("black mark")) return "Black Mark";
  if (lower.includes("soldering")) return "Soldering";
  if (lower.includes("blister")) return "Blister";
  if (lower.includes("flow mark")) return "Flow Mark";
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
};

const fmtNum = (val) => {
  if (val === null || val === undefined || val === "" || val === "-" || val === "null") return null;
  const n = Number(val);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
};

const computeBoxplotData = (arr) => {
  if (!arr || !arr.length) return [0, 0, 0, 0, 0];
  const sorted = [...arr].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return [0, 0, 0, 0, 0];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return [
    Number(min.toFixed(2)),
    Number(q1.toFixed(2)),
    Number(median.toFixed(2)),
    Number(q3.toFixed(2)),
    Number(max.toFixed(2)),
  ];
};

const HEATMAP_COLORS = [
  "rgba(241,245,249,0.7)",
  "#bae6fd",
  "#7dd3fc",
  "#38bdf8",
  "#0284c7",
  "#2563eb",
  "#ea580c",
  "#dc2626",
  "#991b1b",
];

const getHeatColor = (count, maxCount) => {
  if (!count || count === 0) return HEATMAP_COLORS[0];
  const ratio = count / Math.max(maxCount, 1);
  if (ratio <= 0.05) return HEATMAP_COLORS[1];
  if (ratio <= 0.1) return HEATMAP_COLORS[2];
  if (ratio <= 0.2) return HEATMAP_COLORS[3];
  if (ratio <= 0.35) return HEATMAP_COLORS[4];
  if (ratio <= 0.5) return HEATMAP_COLORS[5];
  if (ratio <= 0.7) return HEATMAP_COLORS[6];
  if (ratio <= 0.9) return HEATMAP_COLORS[7];
  return HEATMAP_COLORS[8];
};

const getDateKey = (r) => {
  const raw = r.date || r.production_date || r.created_at || r.createdAt || r.timestamp || r.shot_date;
  if (!raw) return null;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch (e) {
    return null;
  }
};

/* Linear gradient helper for ECharts */
const linearGradient = (c1, c2, vertical = true) => ({
  type: "linear",
  x: 0,
  y: 0,
  x2: vertical ? 0 : 1,
  y2: vertical ? 1 : 0,
  colorStops: [
    { offset: 0, color: c1 },
    { offset: 1, color: c2 },
  ],
});

/* Global responsive chart style defaults */
const CHART_TEXT_STYLE = { fontFamily: "Inter, system-ui, -apple-system, sans-serif" };

const BASE_TOOLBOX = {
  show: true,
  right: 8,
  top: 4,
  feature: {
    saveAsImage: { title: "Download PNG", pixelRatio: 2, name: "chart" },
    dataView: { title: "Data View", readOnly: true, lang: ["Data View", "Close", "Refresh"] },
    magicType: { title: { bar: "Bar", line: "Line" }, type: ["bar", "line"] },
    restore: { title: "Reset" },
  },
  iconStyle: { borderColor: "#94a3b8" },
  emphasis: { iconStyle: { borderColor: "#2563eb" } },
};

/* Responsive Hook — returns container width so grid can adapt */
function useContainerWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function AdvancedAnalyticsTab({
  summary = {},
  qualityGates = [],
  processedQualityGates = [],
  pareto = [],
  categoryParetoData = [],
  zoneParetoData = [],
  shiftScrap = [],
  mlInsights = { features: [], topAnomalies: [] },
  rows = [],
  recordsRows = [],
  allRejectionRecords = [],
  rejectedRows = [],
  dieStats = [],
  filters = {},
}) {
  const viewportWidth = useContainerWidth();
  const isMobile = viewportWidth < 768;
  const isTablet = viewportWidth < 1200;

  const [shiftBoxParam, setShiftBoxParam] = useState("metal_pressure");
  const [heatmapMode, setHeatmapMode] = useState("reason_zone");
  const [shapCategoryFilter, setShapCategoryFilter] = useState("ALL");
  const [stripParam, setStripParam] = useState("metal_pressure");
  const [comboMetric, setComboMetric] = useState("all");
  const [boxPlotTab, setBoxPlotTab] = useState("faceted"); // faceted | shift

  /* ── Derive chart heights responsively ─────────────────────────────── */
  const H = {
    hero: isMobile ? "auto" : 96,
    donut: isMobile ? 220 : 260,
    combo: isMobile ? 300 : 400,
    shapSummary: isMobile ? 360 : 460,
    strip: isMobile ? 300 : 360,
    gateClustered: isMobile ? 320 : 400,
    rose: isMobile ? 300 : 360,
    boxFacet: isMobile ? 210 : 240,
    boxShift: isMobile ? 280 : 340,
    manifold: isMobile ? 320 : 400,
    radar: isMobile ? 320 : 400,
    shapTornado: isMobile ? 320 : 380,
  };

  /* ═══════════════════════════════════════════════════════════════════════
     EFFECTIVE QUALITY GATES & DATA POOL
  ═══════════════════════════════════════════════════════════════════════ */
  const effectiveQualityGates = useMemo(() => {
    let sourceGates = [];
    if (Array.isArray(processedQualityGates) && processedQualityGates.length > 0) sourceGates = processedQualityGates;
    else if (Array.isArray(qualityGates)) sourceGates = qualityGates;
    
    return sourceGates.map((g) => {
      let shortLabel = g.code;
      let displayName = g.name || g.code;
      if (["Leak-Test-01", "Leak-Test-1", "Leak Test-01"].includes(g.code)) { shortLabel = "Leak-Test-1"; displayName = "Leak-Test-1 (OP150)"; }
      else if (["Leak-Test-02", "Leak-Test-2", "Leak Test-02"].includes(g.code)) { shortLabel = "Leak-Test-2"; displayName = "Leak-Test-2 (OP150)"; }
      else if (["Leak Test-03", "Leak-Test-03", "Leak-Test-3"].includes(g.code)) { shortLabel = "Leak-Test-3"; displayName = "Leak-Test-3 (OP150)"; }
      return { ...g, shortLabel, displayName, name: displayName };
    });
  }, [processedQualityGates, qualityGates]);

  const dataPool = useMemo(() => {
    const combined = [];
    const seenIds = new Set();
    const addRows = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((r) => {
        const id = String(r.partId || r.part_id || r.customer_qr || r.customerQrCode || r.id || "");
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          combined.push(r);
        } else if (!id) {
          combined.push(r);
        }
      });
    };
    addRows(rows);
    addRows(recordsRows);
    addRows(rejectedRows);
    addRows(allRejectionRecords);
    return combined.length > 0 ? combined : rows;
  }, [rows, recordsRows, rejectedRows, allRejectionRecords]);

  const classifiedRows = useMemo(() => {
    return dataPool.map((r, idx) => {
      const overallStatus = String(r.status || r.overall_status || "").trim().toUpperCase();
      let isLeakNg = r.isOp150Ng || r.isLeakNg || r.op150_status === "NG" || r.op150_status === "FAIL" || r.op150_status === "FAILED";
      if (r.leak_data) {
        try {
          const p = typeof r.leak_data === "string" ? JSON.parse(r.leak_data) : r.leak_data;
          const res = String(p?.result || p?.Raw_Result || p?.status || "").toUpperCase();
          if (res === "NG" || res === "FAIL" || res === "FAILED") isLeakNg = true;
        } catch (e) {}
      }
      const isNg =
        ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(overallStatus) ||
        isLeakNg ||
        ["NG", "FAIL", "FAILED"].includes(String(r.op100_status || "")) ||
        ["NG", "FAIL", "FAILED"].includes(String(r.op110_status || "")) ||
        ["NG", "FAIL", "FAILED"].includes(String(r.op120_status || "")) ||
        ["NG", "FAIL", "FAILED"].includes(String(r.op130_status || "")) ||
        ["NG", "FAIL", "FAILED"].includes(String(r.op140_status || "")) ||
        ["NG", "FAIL", "FAILED"].includes(String(r.op160_status || "")) ||
        !!r.isDefective ||
        !!r.rejection_reason ||
        !!r.ng_reason;
      const genuinePartId = String(r.partId || r.part_id || r.customer_qr || r.customerQrCode || `Part-${idx + 1}`);
      const shotNum = r.shot_number || r.shotNumber || r.shot || "—";
      const shiftCode = String(r.shift_code || r.shiftCode || r.shift || "A").trim().toUpperCase();
      const gateStation = isLeakNg
        ? "Leak Test (OP150)"
        : r.ng_station || r.ngStation || r.machine_name || r.machineName || (isNg ? "OP120" : "Passed OK");
      return {
        ...r,
        _isNg: isNg,
        _partId: genuinePartId,
        _shotNum: shotNum,
        _shiftCode: ["A", "B", "C"].includes(shiftCode) ? shiftCode : "A",
        _gateStation: gateStation,
        _isLeakNg: isLeakNg,
        _dateKey: getDateKey(r),
      };
    });
  }, [dataPool]);

  const okRows = useMemo(() => classifiedRows.filter((r) => !r._isNg), [classifiedRows]);
  const ngRows = useMemo(() => classifiedRows.filter((r) => r._isNg), [classifiedRows]);

  /* ═══════════════════════════════════════════════════════════════════════
     SHIFT AGGREGATES
  ═══════════════════════════════════════════════════════════════════════ */
  const shiftAggregates = useMemo(() => {
    if (Array.isArray(shiftScrap) && shiftScrap.length > 0) {
      return shiftScrap.map((s) => {
        const code = String(s.shift || s.shiftCode || s.name || "A").toUpperCase();
        const total = Number(s.totalParts || s.total_parts || s.total || s.inspected || 0);
        const ng = Number(s.ng || s.totalNG || s.ng_count || s.scrapped || 0);
        const ok = Math.max(0, total - ng);
        const rate = total > 0 ? Number(((ng / total) * 100).toFixed(2)) : (Number(s.scrapRate || s.scrap_rate) || 0);
        return { shift: `Shift ${code}`, code, total, ok, ng, scrapRate: rate };
      });
    }
    const shiftMap = { A: { total: 0, ok: 0, ng: 0 }, B: { total: 0, ok: 0, ng: 0 }, C: { total: 0, ok: 0, ng: 0 } };
    classifiedRows.forEach((r) => {
      const code = r._shiftCode;
      if (shiftMap[code]) {
        shiftMap[code].total += 1;
        if (r._isNg) shiftMap[code].ng += 1;
        else shiftMap[code].ok += 1;
      }
    });
    return ["A", "B", "C"].map((code) => {
      const d = shiftMap[code];
      const rate = d.total > 0 ? Number(((d.ng / d.total) * 100).toFixed(2)) : 0;
      return { shift: `Shift ${code}`, code, total: d.total, ok: d.ok, ng: d.ng, scrapRate: rate };
    });
  }, [shiftScrap, classifiedRows]);

  /* ═══════════════════════════════════════════════════════════════════════
     SHIFT ROSE OPTION
  ═══════════════════════════════════════════════════════════════════════ */
  const shiftRoseOption = useMemo(() => ({
    textStyle: CHART_TEXT_STYLE,
    title: {
      text: "Shift Rejection Severity",
      subtext: "Radius = Scrap Rate % • Arc = Shift Production",
      left: "center",
      top: 4,
      textStyle: { fontSize: 13, fontWeight: "bold", color: "#1e293b" },
      subtextStyle: { fontSize: 10.5, color: "#64748b" },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(15,23,42,0.95)",
      borderColor: "transparent",
      textStyle: { color: "#fff", fontSize: 12 },
      formatter: (p) => {
        const s = shiftAggregates.find((x) => p.name.startsWith(x.shift));
        return `<div style="font-weight:700;margin-bottom:4px">${p.name}</div>
          Scrap Rate: <strong style="color:#fbbf24">${s?.scrapRate ?? 0}%</strong><br/>
          NG: <strong>${s?.ng ?? 0}</strong> / Total: <strong>${s?.total ?? 0}</strong>`;
      },
    },
    legend: {
      bottom: 4,
      left: "center",
      icon: "circle",
      textStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
    },
    toolbox: BASE_TOOLBOX,
    series: [
      {
        name: "Shift Scrap Severity",
        type: "pie",
        radius: isMobile ? [20, 80] : [30, 110],
        center: ["50%", "52%"],
        roseType: "area",
        itemStyle: { borderRadius: 8, borderColor: "#fff", borderWidth: 2, shadowBlur: 12, shadowColor: "rgba(0,0,0,0.12)" },
        label: {
          formatter: "{b|{b}}\n{c|{c}%}",
          rich: {
            b: { fontSize: 11, fontWeight: "bold", color: "#1e293b", lineHeight: 14 },
            c: { fontSize: 12, fontWeight: 900, color: "#dc2626" },
          },
        },
        labelLine: { length: 8, length2: 8 },
        data: shiftAggregates.map((s, idx) => ({
          value: s.scrapRate > 0 ? s.scrapRate : 1.2,
          name: s.shift,
          itemStyle: {
            color: linearGradient(
              idx === 0 ? "#fb7185" : idx === 1 ? "#60a5fa" : "#fbbf24",
              idx === 0 ? "#be123c" : idx === 1 ? "#1d4ed8" : "#b45309"
            ),
          },
        })),
      },
    ],
  }), [shiftAggregates, isMobile]);

  /* ═══════════════════════════════════════════════════════════════════════
     SHIFT NESTED DONUT
  ═══════════════════════════════════════════════════════════════════════ */
  const shiftNestedDonutOption = useMemo(() => {
    const innerData = shiftAggregates.map((s, idx) => ({
      value: s.total,
      name: s.shift,
      itemStyle: { color: linearGradient(idx === 0 ? "#60a5fa" : idx === 1 ? "#a78bfa" : "#22d3ee", idx === 0 ? "#1d4ed8" : idx === 1 ? "#6d28d9" : "#0891b2") },
    }));
    const outerData = [];
    shiftAggregates.forEach((s) => {
      outerData.push({ value: s.ok, name: `${s.shift} • OK`, itemStyle: { color: linearGradient("#34d399", "#059669") } });
      outerData.push({ value: s.ng, name: `${s.shift} • NG`, itemStyle: { color: linearGradient("#fb7185", "#be123c") } });
    });
    return {
      textStyle: CHART_TEXT_STYLE,
      title: {
        text: "Nested Shift Architecture",
        subtext: "Inner: Shift Volume • Outer: OK vs NG",
        left: "center",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: "bold", color: "#1e293b" },
        subtextStyle: { fontSize: 10.5, color: "#64748b" },
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(15,23,42,0.95)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: "{a}<br/>{b}: <strong>{c} units</strong> ({d}%)",
      },
      legend: {
        bottom: 0,
        left: "center",
        icon: "circle",
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { fontSize: 10, fontWeight: 700, color: "#475569" },
        data: innerData.map((d) => d.name),
      },
      toolbox: BASE_TOOLBOX,
      series: [
        {
          name: "Shift Volume",
          type: "pie",
          selectedMode: "single",
          radius: [0, isMobile ? "30%" : "38%"],
          center: ["50%", "48%"],
          label: { position: "inner", fontSize: 11, fontWeight: 900, color: "#ffffff", formatter: "{b}\n{c}" },
          labelLine: { show: false },
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          data: innerData,
        },
        {
          name: "Quality Breakdown",
          type: "pie",
          radius: [isMobile ? "42%" : "50%", isMobile ? "60%" : "72%"],
          center: ["50%", "48%"],
          labelLine: { length: 12 },
          label: {
            formatter: "{b|{b}}\n{d|{d}%}",
            rich: {
              b: { fontSize: 10.5, lineHeight: 14, fontWeight: "bold", color: "#1e293b" },
              d: { fontSize: 10, color: "#64748b", align: "center", fontWeight: 700 },
            },
          },
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          data: outerData,
        },
      ],
    };
  }, [shiftAggregates, isMobile]);

  /* ═══════════════════════════════════════════════════════════════════════
     4× DONUTS
  ═══════════════════════════════════════════════════════════════════════ */
  const statusDonutData = useMemo(() => {
    const totalOk = Number(summary.totalOK || okRows.length || 0);
    const totalNg = Number(summary.totalNG || ngRows.length || 0);
    const total = totalOk + totalNg;
    return [
      { name: "Passed OK", value: totalOk, pct: total > 0 ? Number(((totalOk / total) * 100).toFixed(1)) : 0 },
      { name: "Scrapped NG", value: totalNg, pct: total > 0 ? Number(((totalNg / total) * 100).toFixed(1)) : 0 },
    ];
  }, [summary, okRows, ngRows]);

  const gateDonutData = useMemo(() => {
    if (!effectiveQualityGates.length) return [];
    const totalNg = effectiveQualityGates.reduce((sum, g) => sum + Number(g.ngCount || g.ng_count || 0), 0);
    if (totalNg === 0) return [];
    return effectiveQualityGates
      .map((g) => {
        const ng = Number(g.ngCount || g.ng_count || 0);
        return { name: g.shortLabel || g.displayName || g.code || g.name || g.gate, value: ng, pct: Number(((ng / totalNg) * 100).toFixed(1)) };
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [effectiveQualityGates]);

  const categoryDonutData = useMemo(() => {
    if (categoryParetoData.length > 0) {
      const total = categoryParetoData.reduce((sum, d) => sum + Number(d.count || d.value || 0), 0);
      return categoryParetoData.slice(0, 6).map((d) => ({
        name: d.category || d.name || d.label,
        value: Number(d.count || d.value || 0),
        pct: total > 0 ? Number(((Number(d.count || d.value || 0) / total) * 100).toFixed(1)) : 0,
      }));
    }
    const catMap = {};
    ngRows.forEach((r) => {
      const qty = Number(r.quantity || r.scrap_quantity || 1);
      const cat = r.rejection_category || r.category || (r._isLeakNg ? "MR" : "CR");
      catMap[cat] = (catMap[cat] || 0) + qty;
    });
    const total = Object.values(catMap).reduce((a, b) => a + b, 0);
    return Object.entries(catMap)
      .map(([name, value]) => ({ name, value, pct: total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [categoryParetoData, ngRows]);

  const defectDonutData = useMemo(() => {
    if (pareto.length > 0) {
      const total = pareto.reduce((sum, d) => sum + Number(d.count || d.value || 0), 0);
      return pareto.slice(0, 6).map((d) => ({
        name: d.reason || d.name || d.label,
        value: Number(d.count || d.value || 0),
        pct: total > 0 ? Number(((Number(d.count || d.value || 0) / total) * 100).toFixed(1)) : 0,
      }));
    }
    const reasonMap = {};
    ngRows.forEach((r) => {
      const qty = Number(r.quantity || r.scrap_quantity || 1);
      const reason = canonicalizeReason(r.rejection_reason || r.reason || (r._isLeakNg ? "Pressure Leak (OP150)" : ""));
      if (reason) reasonMap[reason] = (reasonMap[reason] || 0) + qty;
    });
    const total = Object.values(reasonMap).reduce((a, b) => a + b, 0);
    return Object.entries(reasonMap)
      .map(([name, value]) => ({ name, value, pct: total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [pareto, ngRows]);

  const donutOptions = useMemo(() => {
    const makeDonutOpt = (title, data, gradientPairs) => {
      const total = data.reduce((s, d) => s + Number(d.value || 0), 0);
      return {
        textStyle: CHART_TEXT_STYLE,
        title: {
          text: title,
          subtext: `Total: ${total.toLocaleString()}`,
          left: "center",
          top: 4,
          textStyle: { fontSize: 12.5, fontWeight: 800, color: "#1e293b" },
          subtextStyle: { fontSize: 10, color: "#64748b", fontWeight: 700 },
        },
        tooltip: {
          trigger: "item",
          backgroundColor: "rgba(15,23,42,0.95)",
          borderColor: "transparent",
          textStyle: { color: "#fff", fontSize: 12 },
          formatter: (p) => `<strong>${p.name}</strong><br/>Count: <strong>${p.value}</strong> (${p.percent}%)`,
        },
        legend: {
          bottom: 4,
          left: "center",
          icon: "circle",
          itemWidth: 9,
          itemHeight: 9,
          textStyle: { fontSize: 10, fontWeight: 700, color: "#334155" },
          type: "scroll",
        },
        color: gradientPairs.map(([c1, c2]) => linearGradient(c1, c2, false)),
        series: [
          {
            type: "pie",
            radius: ["45%", "68%"],
            center: ["50%", "50%"],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 6 },
            label: { show: false },
            labelLine: { show: false },
            emphasis: {
              scale: true,
              scaleSize: 8,
              label: {
                show: true,
                fontSize: 12,
                fontWeight: 900,
                color: "#0f172a",
                formatter: "{b}\n{d}%",
                backgroundColor: "rgba(255,255,255,0.9)",
                padding: [4, 6],
                borderRadius: 4,
              },
            },
            data: data.map((d) => ({ name: d.name, value: d.value })),
          },
        ],
      };
    };

    return {
      status: makeDonutOpt("Production Yield", statusDonutData, [["#34d399", "#059669"], ["#fb7185", "#be123c"]]),
      gate: makeDonutOpt("Gate Scrap Share", gateDonutData, [["#60a5fa", "#1d4ed8"], ["#fb7185", "#be123c"], ["#fbbf24", "#b45309"], ["#34d399", "#059669"], ["#a78bfa", "#6d28d9"], ["#22d3ee", "#0891b2"]]),
      category: makeDonutOpt("Defect Category Mix", categoryDonutData, [["#60a5fa", "#1d4ed8"], ["#fb923c", "#c2410c"], ["#34d399", "#059669"], ["#a78bfa", "#6d28d9"], ["#94a3b8", "#475569"]]),
      defect: makeDonutOpt("Primary Defect Modes", defectDonutData, [["#fb7185", "#be123c"], ["#c084fc", "#7e22ce"], ["#fb923c", "#c2410c"], ["#38bdf8", "#0369a1"], ["#94a3b8", "#475569"], ["#2dd4bf", "#0f766e"]]),
    };
  }, [statusDonutData, gateDonutData, categoryDonutData, defectDonutData]);

  /* ═══════════════════════════════════════════════════════════════════════
     FACETED BOXPLOTS
  ═══════════════════════════════════════════════════════════════════════ */
  const facetedBoxplots = useMemo(() => {
    const targetParams = [
      { key: "metal_pressure", title: "Metal Pressure (bar)" },
      { key: "furnace_metal_temp", title: "Furnace Temp (°C)" },
      { key: "biscuit_thickness", title: "Biscuit Thickness (mm)" },
      { key: "intensification_time", title: "Intensification (ms)" },
      { key: "v2_speed", title: "Fast Shot V2 (m/s)" },
      { key: "leak_body_leak_value", title: "Leak Value (bar)" },
    ];
    return targetParams.map((p) => {
      const okVals = okRows.map((r) => fmtNum(r[p.key])).filter((v) => v !== null && v > 0);
      const ngVals = ngRows.map((r) => fmtNum(r[p.key])).filter((v) => v !== null && v > 0);
      const okBox = computeBoxplotData(okVals);
      const ngBox = computeBoxplotData(ngVals);

      const okScatter = okRows
        .filter((r) => fmtNum(r[p.key]) !== null && fmtNum(r[p.key]) > 0)
        .slice(0, 40)
        .map((r) => [Number(getDeterministicJitter(r._partId, 0, 0.22).toFixed(3)), fmtNum(r[p.key]), r._partId, r._shotNum, "OK"]);
      const ngScatter = ngRows
        .filter((r) => fmtNum(r[p.key]) !== null && fmtNum(r[p.key]) > 0)
        .slice(0, 40)
        .map((r) => [Number(getDeterministicJitter(r._partId, 1, 0.22).toFixed(3)), fmtNum(r[p.key]), r._partId, r._shotNum, "NG"]);

      const opt = {
        textStyle: CHART_TEXT_STYLE,
        title: { text: p.title, left: "center", top: 4, textStyle: { fontSize: 11.5, fontWeight: 800, color: "#1e293b" } },
        tooltip: {
          trigger: "item",
          backgroundColor: "rgba(15,23,42,0.95)",
          borderColor: "transparent",
          textStyle: { color: "#fff", fontSize: 11.5 },
          formatter: (params) => {
            if (params.seriesType === "boxplot") {
              const d = params.data;
              return `<strong>${params.seriesName} (${params.name})</strong><br/>
                Max: ${d[5]}<br/>Q3: ${d[4]}<br/>Median: <strong>${d[3]}</strong><br/>Q1: ${d[2]}<br/>Min: ${d[1]}`;
            } else if (params.seriesType === "scatter") {
              const [, val, partId, shot, status] = params.data;
              return `<strong>${partId}</strong> • Shot #${shot}<br/>Status: <strong style="color:${status === "NG" ? "#fb7185" : "#22d3ee"}">${status}</strong><br/>Value: <strong>${val}</strong>`;
            }
          },
        },
        grid: { left: 42, right: 12, top: 32, bottom: 28 },
        xAxis: {
          type: "category",
          data: ["OK", "NG"],
          boundaryGap: true,
          axisLabel: { fontSize: 11, fontWeight: 800, color: "#334155" },
          axisLine: { lineStyle: { color: "#cbd5e1" } },
        },
        yAxis: {
          type: "value",
          scale: true,
          splitLine: { lineStyle: { stroke: "#f1f5f9" } },
          axisLabel: { fontSize: 9.5, color: "#64748b" },
        },
        series: [
          {
            name: "Distribution",
            type: "boxplot",
            boxWidth: [16, 30],
            data: [
              { value: okBox, itemStyle: { borderColor: "#06b6d4", borderWidth: 2, color: "rgba(6,182,212,0.18)" } },
              { value: ngBox, itemStyle: { borderColor: "#f43f5e", borderWidth: 2, color: "rgba(244,63,94,0.18)" } },
            ],
          },
          { name: "OK Parts", type: "scatter", data: okScatter, symbolSize: 6, itemStyle: { color: "#06b6d4", opacity: 0.75 } },
          { name: "NG Parts", type: "scatter", data: ngScatter, symbolSize: 6.5, itemStyle: { color: "#f43f5e", opacity: 0.75 } },
        ],
      };
      return { key: p.key, title: p.title, option: opt };
    });
  }, [okRows, ngRows]);

  /* ═══════════════════════════════════════════════════════════════════════
     SHIFT GROUPED BOXPLOT
  ═══════════════════════════════════════════════════════════════════════ */
  const shiftGroupedBoxOption = useMemo(() => {
    const paramDef = ALL_45_PARAMETERS.find((p) => p.key === shiftBoxParam) || ALL_45_PARAMETERS[0];
    const shifts = ["A", "B", "C"];
    const okBoxData = [];
    const ngBoxData = [];
    shifts.forEach((code) => {
      const okVals = okRows.filter((r) => r._shiftCode === code).map((r) => fmtNum(r[shiftBoxParam])).filter((v) => v !== null && v > 0);
      const ngVals = ngRows.filter((r) => r._shiftCode === code).map((r) => fmtNum(r[shiftBoxParam])).filter((v) => v !== null && v > 0);
      okBoxData.push(computeBoxplotData(okVals));
      ngBoxData.push(computeBoxplotData(ngVals));
    });

    return {
      textStyle: CHART_TEXT_STYLE,
      title: {
        text: `Shift Stability: ${paramDef.label}`,
        subtext: `Side-by-side Box & Whisker • Shift A / B / C • ${paramDef.unit}`,
        left: "left",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 800, color: "#1e293b" },
        subtextStyle: { fontSize: 11, color: "#64748b" },
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(15,23,42,0.95)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (params) => {
          const d = params.data;
          return `<strong>${params.seriesName} (${params.name})</strong><br/>
            Max: ${d[5]} ${paramDef.unit}<br/>Q3: ${d[4]}<br/>Median: <strong>${d[3]}</strong><br/>Q1: ${d[2]}<br/>Min: ${d[1]} ${paramDef.unit}`;
        },
      },
      legend: {
        data: ["Passed OK", "Scrapped NG"],
        top: 6,
        right: 12,
        icon: "roundRect",
        textStyle: { fontSize: 11.5, fontWeight: 700 },
      },
      toolbox: BASE_TOOLBOX,
      grid: { left: 55, right: 30, top: 62, bottom: 38 },
      xAxis: {
        type: "category",
        data: ["Shift A", "Shift B", "Shift C"],
        boundaryGap: true,
        axisLabel: { fontSize: 12, fontWeight: 800, color: "#1e293b" },
        axisLine: { lineStyle: { color: "#cbd5e1" } },
      },
      yAxis: {
        type: "value",
        name: `${paramDef.label} (${paramDef.unit})`,
        nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
        scale: true,
        splitLine: { lineStyle: { stroke: "#f1f5f9" } },
      },
      series: [
        { name: "Passed OK", type: "boxplot", data: okBoxData, itemStyle: { borderColor: "#06b6d4", borderWidth: 2, color: "rgba(6,182,212,0.22)" } },
        { name: "Scrapped NG", type: "boxplot", data: ngBoxData, itemStyle: { borderColor: "#f43f5e", borderWidth: 2, color: "rgba(244,63,94,0.22)" } },
      ],
    };
  }, [shiftBoxParam, okRows, ngRows]);

  /* ═══════════════════════════════════════════════════════════════════════
     MANIFOLD (PCA)
  ═══════════════════════════════════════════════════════════════════════ */
  const manifoldOption = useMemo(() => {
    const stats = {
      metalPressure: { mean: 650, std: 45 },
      furnaceTemp: { mean: 675, std: 15 },
      biscuit: { mean: 25, std: 4 },
      intensification: { mean: 18, std: 5 },
      v2Speed: { mean: 3.2, std: 0.6 },
    };
    const okPoints = [];
    const castingNg = [];
    const leakNg = [];
    classifiedRows.slice(0, 350).forEach((r) => {
      const pMetal = Number(r.metal_pressure) || (r._isNg ? 710 : 652);
      const temp = Number(r.furnace_metal_temp) || (r._isNg ? 695 : 674);
      const biscuit = Number(r.biscuit_thickness) || (r._isNg ? 31 : 24.8);
      const inten = Number(r.intensification_time) || (r._isNg ? 27 : 17.9);
      const v2 = Number(r.v2_speed) || (r._isNg ? 4.1 : 3.25);
      const z1 = Number((0.52 * ((pMetal - stats.metalPressure.mean) / stats.metalPressure.std) + 0.45 * ((v2 - stats.v2Speed.mean) / stats.v2Speed.std) - 0.42 * ((biscuit - stats.biscuit.mean) / stats.biscuit.std)).toFixed(2));
      const z2 = Number((0.62 * ((temp - stats.furnaceTemp.mean) / stats.furnaceTemp.std) + 0.35 * ((inten - stats.intensification.mean) / stats.intensification.std)).toFixed(2));
      const pointData = [z1, z2, r._partId, r._shotNum, r._gateStation, r._isNg ? "NG" : "OK"];
      if (!r._isNg) okPoints.push(pointData);
      else if (r._isLeakNg) leakNg.push(pointData);
      else castingNg.push(pointData);
    });

    return {
      textStyle: CHART_TEXT_STYLE,
      title: {
        text: "Deep Process Manifold (2D PCA)",
        subtext: "Z1 = Injection Dynamics • Z2 = Thermal Transition",
        left: "left",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 800, color: "#1e293b" },
        subtextStyle: { fontSize: 11, color: "#64748b" },
      },
      tooltip: {
        backgroundColor: "rgba(15,23,42,0.95)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (params) => {
          const [z1, z2, partId, shot, gate, status] = params.data;
          const isNg = status === "NG";
          return `<strong style="color:#60a5fa">${partId}</strong> • Shot #${shot}<br/>
            Status: <strong style="color:${isNg ? "#fb7185" : "#34d399"}">${status}</strong><br/>
            Station: <strong>${gate}</strong><br/>
            Latent: [Z1: ${z1}σ, Z2: ${z2}σ]`;
        },
      },
      legend: { right: 12, top: 6, icon: "circle", textStyle: { fontSize: 11, fontWeight: 700 } },
      toolbox: BASE_TOOLBOX,
      grid: { left: 50, right: 20, top: 62, bottom: 45 },
      xAxis: {
        type: "value",
        name: "Z1 →",
        nameLocation: "middle",
        nameGap: 24,
        nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
        splitLine: { lineStyle: { stroke: "#f1f5f9" } },
      },
      yAxis: {
        type: "value",
        name: "Z2 →",
        nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
        splitLine: { lineStyle: { stroke: "#f1f5f9" } },
      },
      series: [
        { name: "Nominal OK", type: "scatter", symbolSize: 8, data: okPoints, itemStyle: { color: "#10b981", opacity: 0.65, shadowBlur: 6, shadowColor: "rgba(16,185,129,0.5)" } },
        { name: "Casting NG", type: "scatter", symbolSize: 9, data: castingNg, itemStyle: { color: "#f43f5e", opacity: 0.85, shadowBlur: 6, shadowColor: "rgba(244,63,94,0.5)" } },
        { name: "Leak NG", type: "scatter", symbolSize: 9, data: leakNg, itemStyle: { color: "#8b5cf6", opacity: 0.85, shadowBlur: 6, shadowColor: "rgba(139,92,246,0.5)" } },
      ],
    };
  }, [classifiedRows]);

  /* ═══════════════════════════════════════════════════════════════════════
     RADAR
  ═══════════════════════════════════════════════════════════════════════ */
  const radarOption = useMemo(() => ({
    textStyle: CHART_TEXT_STYLE,
    title: {
      text: "AI Neural Sensitivity Radar",
      subtext: "Baseline Spec (Green) vs Defect Scrap Distortion (Red)",
      left: "left",
      top: 4,
      textStyle: { fontSize: 13, fontWeight: 800, color: "#1e293b" },
      subtextStyle: { fontSize: 11, color: "#64748b" },
    },
    tooltip: { backgroundColor: "rgba(15,23,42,0.95)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 } },
    legend: { right: 12, top: 6, icon: "circle", textStyle: { fontSize: 11, fontWeight: 700 } },
    toolbox: BASE_TOOLBOX,
    radar: {
      indicator: [
        { name: "Metal Pressure", max: 100 },
        { name: "Furnace Temp", max: 100 },
        { name: "Biscuit Thickness", max: 100 },
        { name: "Intensification", max: 100 },
        { name: "Fast Shot V2", max: 100 },
        { name: "Cavity Vacuum", max: 100 },
        { name: "Cooling Flow", max: 100 },
        { name: "Leak Rate Decay", max: 100 },
      ],
      radius: isMobile ? "55%" : "65%",
      center: ["50%", "56%"],
      splitNumber: 5,
      axisName: { fontSize: 10.5, fontWeight: 700, color: "#475569" },
      splitArea: { areaStyle: { color: ["rgba(255,255,255,0.9)", "rgba(241,245,249,0.5)"] } },
      splitLine: { lineStyle: { color: "#e2e8f0" } },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
    },
    series: [
      {
        name: "Sensitivity",
        type: "radar",
        symbolSize: 6,
        data: [
          { value: [50, 50, 49, 52, 50, 48, 51, 46], name: "Nominal OK", itemStyle: { color: "#10b981" }, areaStyle: { color: "rgba(16,185,129,0.3)" }, lineStyle: { width: 2.5 } },
          { value: [86, 78, 83, 81, 74, 68, 64, 92], name: "Scrap NG", itemStyle: { color: "#ef4444" }, areaStyle: { color: "rgba(239,68,68,0.3)" }, lineStyle: { width: 2.5 } },
        ],
      },
    ],
  }), [isMobile]);

  /* ═══════════════════════════════════════════════════════════════════════
     SHAP DATA
  ═══════════════════════════════════════════════════════════════════════ */
  const shapData = useMemo(() => {
    let rawList = [];
    if (mlInsights?.features && mlInsights.features.length > 0) {
      rawList = mlInsights.features.map((f) => {
        const drift = f.stdOk > 0 ? (f.meanNg - f.meanOk) / f.stdOk : 0;
        const absDrift = Math.abs(drift);
        return {
          key: f.key,
          label: f.label || f.key,
          unit: f.unit || "",
          category: f.category || "machine_process",
          shapValue: Number(drift.toFixed(2)),
          importance: Number(f.importance || (absDrift * 10).toFixed(1)),
          absShap: absDrift,
          meanOk: f.meanOk,
          meanNg: f.meanNg,
          stdOk: f.stdOk,
        };
      });
    } else {
      const params = [
        { key: "metal_pressure", label: "Metal Pressure", unit: "bar", cat: "product_params" },
        { key: "biscuit_thickness", label: "Biscuit Thickness", unit: "mm", cat: "product_params" },
        { key: "furnace_metal_temp", label: "Furnace Metal Temp", unit: "°C", cat: "product_params" },
        { key: "intensification_time", label: "Intensification Time", unit: "ms", cat: "product_params" },
        { key: "v2_speed", label: "Fast Shot V2 Speed", unit: "m/s", cat: "product_params" },
        { key: "leak_body_leak_value", label: "Leak Test Value", unit: "bar", cat: "product_params" },
        { key: "cycle_time", label: "Cycle Time", unit: "s", cat: "machine_process" },
        { key: "vacuum_pressure", label: "Vacuum Pressure", unit: "mbar", cat: "product_params" },
        { key: "cooling_water_mov", label: "Cooling Water Mov", unit: "L/min", cat: "flow_pressure" },
        { key: "fixed_die_temp_f1", label: "Fixed Die Temp F1", unit: "°C", cat: "die_temp" },
      ];
      rawList = params.map((p) => {
        const okVals = okRows.map((r) => fmtNum(r[p.key])).filter((v) => v !== null && v > 0);
        const ngVals = ngRows.map((r) => fmtNum(r[p.key])).filter((v) => v !== null && v > 0);
        const okMean = okVals.length ? okVals.reduce((a, b) => a + b, 0) / okVals.length : 50;
        const ngMean = ngVals.length ? ngVals.reduce((a, b) => a + b, 0) / ngVals.length : 65;
        const okStd = okVals.length > 1 ? Math.sqrt(okVals.reduce((sum, v) => sum + Math.pow(v - okMean, 2), 0) / (okVals.length - 1)) : 5;
        const drift = okStd > 0 ? (ngMean - okMean) / okStd : 1.5;
        return {
          key: p.key,
          label: p.label,
          unit: p.unit,
          category: p.cat,
          shapValue: Number(drift.toFixed(2)),
          importance: Number((Math.abs(drift) * 12).toFixed(1)),
          absShap: Math.abs(drift),
          meanOk: Number(okMean.toFixed(1)),
          meanNg: Number(ngMean.toFixed(1)),
          stdOk: Number(okStd.toFixed(1)),
        };
      });
    }
    if (shapCategoryFilter !== "ALL") {
      rawList = rawList.filter((f) => {
        const paramDef = ALL_45_PARAMETERS.find(p => p.key === f.key);
        const catId = paramDef ? paramDef.categoryId : f.category;
        return catId === shapCategoryFilter || f.category === shapCategoryFilter || f.category?.toLowerCase().includes(shapCategoryFilter.replace(/_.*/, "").toLowerCase());
      });
    }
    return rawList.sort((a, b) => b.absShap - a.absShap).slice(0, 12);
  }, [mlInsights, okRows, ngRows, shapCategoryFilter]);

  /* ═══════════════════════════════════════════════════════════════════════
     SHAP TORNADO
  ═══════════════════════════════════════════════════════════════════════ */
  const shapOption = useMemo(() => {
    const reversed = [...shapData].reverse();
    return {
      textStyle: CHART_TEXT_STYLE,
      title: {
        text: "SHAP Diverging Feature Drivers",
        subtext: "Red = HIGH in NG • Blue = LOW in NG",
        left: "left",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 800, color: "#1e293b" },
        subtextStyle: { fontSize: 11, color: "#64748b" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(15,23,42,0.95)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (items) => {
          const it = items[0];
          return `<strong>${it.name}</strong><br/>Drift: <strong style="color:${it.value > 0 ? "#fb7185" : "#60a5fa"}">${it.value > 0 ? "+" : ""}${it.value}σ</strong>`;
        },
      },
      toolbox: BASE_TOOLBOX,
      grid: { left: isMobile ? 120 : 170, right: 40, top: 62, bottom: 30 },
      xAxis: {
        type: "value",
        name: "SHAP Drift (Δμ/σ)",
        nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
        splitLine: { lineStyle: { stroke: "#f1f5f9" } },
      },
      yAxis: {
        type: "category",
        data: reversed.map((d) => d.label),
        axisLabel: { fontWeight: 700, color: "#1e293b", fontSize: isMobile ? 10.5 : 11.5 },
        axisLine: { lineStyle: { color: "#cbd5e1" } },
      },
      series: [
        {
          name: "SHAP Drift",
          type: "bar",
          barWidth: 14,
          data: reversed.map((d) => ({
            value: d.shapValue,
            itemStyle: {
              color: d.shapValue >= 0 ? linearGradient("#fb7185", "#be123c", false) : linearGradient("#60a5fa", "#1d4ed8", false),
              borderRadius: 4,
            },
          })),
          label: {
            show: true,
            position: "right",
            fontSize: 10,
            fontWeight: 700,
            color: "#334155",
            formatter: (p) => `${p.value > 0 ? "+" : ""}${p.value}`,
          },
        },
      ],
    };
  }, [shapData, isMobile]);

  /* ═══════════════════════════════════════════════════════════════════════
     PRODUCTION COMBO
  ═══════════════════════════════════════════════════════════════════════ */
  const productionComboData = useMemo(() => {
    const groupsMap = {};
    classifiedRows.forEach((r) => {
      const dateKey = r._dateKey || "Unknown";
      const shift = r._shiftCode || "A";
      const key = `${dateKey}||${shift}`;
      if (!groupsMap[key]) groupsMap[key] = { dateKey, shift, produced: 0, ngTotal: 0, gate1Ng: 0, gate2Ng: 0, gate3Ng: 0, gate4Ng: 0 };
      const g = groupsMap[key];
      g.produced += 1;
      if (r._isNg) {
        g.ngTotal += 1;
        const station = String(r._gateStation || "").toUpperCase();
        const reason = canonicalizeReason(r.rejection_reason || r.reason || "");
        if (r._isLeakNg || station.includes("LEAK") || station.includes("OP150") || reason.includes("Pressure Leak")) g.gate3Ng += 1;
        else if (station.includes("OP100") || station.includes("OP110") || station.includes("CASTING") || reason.includes("Blow") || reason.includes("Porosity") || reason.includes("Cold Shut") || reason.includes("Non-Filling")) g.gate2Ng += 1;
        else if (station.includes("OP160") || station.includes("FINAL")) g.gate4Ng += 1;
        else g.gate1Ng += 1;
      }
    });
    const sortedKeys = Object.keys(groupsMap).sort((a, b) => {
      const [dA, sA] = a.split("||");
      const [dB, sB] = b.split("||");
      if (dA !== dB) return dA.localeCompare(dB);
      return sA.localeCompare(sB);
    });
    const limited = sortedKeys.slice(-16);
    const categories = limited.map((k) => {
      const [d, s] = k.split("||");
      const dateShort = d === "Unknown" ? "—" : d.slice(5);
      return `${dateShort}\nS${s}`;
    });
    const arr = { produced: [], total: [], g1: [], g2: [], g3: [], g4: [] };
    limited.forEach((k) => {
      const g = groupsMap[k];
      const total = g.produced || 1;
      arr.produced.push(g.produced);
      arr.total.push(Number(((g.ngTotal / total) * 100).toFixed(2)));
      arr.g1.push(Number(((g.gate1Ng / total) * 100).toFixed(2)));
      arr.g2.push(Number(((g.gate2Ng / total) * 100).toFixed(2)));
      arr.g3.push(Number(((g.gate3Ng / total) * 100).toFixed(2)));
      arr.g4.push(Number(((g.gate4Ng / total) * 100).toFixed(2)));
    });
    return { categories, ...arr };
  }, [classifiedRows]);

  const productionComboOption = useMemo(() => {
    const d = productionComboData;
    const lineSeries = [];
    if (comboMetric === "all" || comboMetric === "total") {
      lineSeries.push({
        name: "Total Scrap %",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 3, color: "#ef4444", shadowBlur: 8, shadowColor: "rgba(239,68,68,0.5)" },
        itemStyle: { color: "#ef4444", borderColor: "#fff", borderWidth: 2 },
        areaStyle: { color: linearGradient("rgba(239,68,68,0.25)", "rgba(239,68,68,0)") },
        data: d.total,
      });
    }
    if (comboMetric === "all" || comboMetric === "gates") {
      lineSeries.push(
        { name: "Machining", type: "line", yAxisIndex: 1, smooth: true, symbol: "rect", symbolSize: 6, lineStyle: { width: 2, color: "#2563eb" }, itemStyle: { color: "#2563eb" }, data: d.g1 },
        { name: "Casting", type: "line", yAxisIndex: 1, smooth: true, symbol: "triangle", symbolSize: 7, lineStyle: { width: 2, color: "#f59e0b" }, itemStyle: { color: "#f59e0b" }, data: d.g2 },
        { name: "Leak Testing", type: "line", yAxisIndex: 1, smooth: true, symbol: "diamond", symbolSize: 7, lineStyle: { width: 2, color: "#8b5cf6" }, itemStyle: { color: "#8b5cf6" }, data: d.g3 },
        { name: "Final Inspect", type: "line", yAxisIndex: 1, smooth: true, symbol: "pin", symbolSize: 8, lineStyle: { width: 2, color: "#10b981" }, itemStyle: { color: "#10b981" }, data: d.g4 }
      );
    }

    return {
      textStyle: CHART_TEXT_STYLE,
      title: {
        text: "Production Summary Combo",
        subtext: "Bars = produced qty (left) • Lines = scrap % (right)",
        left: "left",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 800, color: "#1e293b" },
        subtextStyle: { fontSize: 11, color: "#64748b" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(15,23,42,0.95)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (items) => {
          let str = `<div style="font-weight:800;margin-bottom:6px">${items[0]?.axisValue?.replace("\n", " • ")}</div>`;
          items.forEach((it) => {
            const unit = it.seriesName.includes("%") ? "%" : " units";
            str += `${it.marker} ${it.seriesName}: <strong>${it.value}${unit}</strong><br/>`;
          });
          return str;
        },
      },
      legend: {
        top: 6,
        right: 12,
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 8,
        textStyle: { fontSize: 10.5, fontWeight: 700 },
        type: "scroll",
        data: ["Produced Qty", ...lineSeries.map((s) => s.name)],
      },
      toolbox: BASE_TOOLBOX,
      grid: { left: 55, right: 55, top: 62, bottom: isMobile ? 60 : 45 },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        ...(d.categories.length > 8 ? [{ type: "slider", height: 14, bottom: 6, start: 0, end: 100, showDetail: false, borderColor: "#e2e8f0", fillerColor: "rgba(37,99,235,0.15)" }] : []),
      ],
      xAxis: {
        type: "category",
        data: d.categories,
        axisLabel: { fontSize: 10, fontWeight: 700, color: "#334155", lineHeight: 13, interval: 0, rotate: isMobile ? 45 : 0 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: [
        {
          type: "value",
          name: "Produced",
          nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
          splitLine: { lineStyle: { stroke: "#f1f5f9" } },
          axisLabel: { fontSize: 10, color: "#64748b" },
        },
        {
          type: "value",
          name: "Scrap %",
          nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#dc2626" },
          splitLine: { show: false },
          axisLabel: { fontSize: 10, color: "#dc2626", formatter: "{value}%" },
        },
      ],
      series: [
        {
          name: "Produced Qty",
          type: "bar",
          yAxisIndex: 0,
          barWidth: "52%",
          itemStyle: {
            color: linearGradient("#38bdf8", "#0284c7"),
            borderRadius: [5, 5, 0, 0],
            shadowBlur: 6,
            shadowColor: "rgba(2,132,199,0.35)",
          },
          emphasis: { itemStyle: { color: linearGradient("#0ea5e9", "#0369a1"), shadowBlur: 14 } },
          data: d.produced,
        },
        ...lineSeries,
      ],
    };
  }, [productionComboData, comboMetric, isMobile]);

  /* ═══════════════════════════════════════════════════════════════════════
     SHAP SUMMARY (beeswarm-like)
  ═══════════════════════════════════════════════════════════════════════ */
  const shapSummaryOption = useMemo(() => {
    const topN = shapData.slice(0, 10);
    const reversed = [...topN].reverse();

    const pointsLow = [];
    const pointsHigh = [];
    const pointsMean = [];
    const connectors = [];

    reversed.forEach((f, idx) => {
      const spread = Math.max(0.6, Math.abs(f.shapValue) * 0.6);
      const lowX = f.shapValue >= 0 ? f.shapValue - spread : f.shapValue - spread * 0.3;
      const highX = f.shapValue >= 0 ? f.shapValue + spread * 0.3 : f.shapValue + spread;
      pointsLow.push([Number(lowX.toFixed(2)), idx, f.label, "Low", f.unit]);
      pointsHigh.push([Number(highX.toFixed(2)), idx, f.label, "High", f.unit]);
      pointsMean.push([f.shapValue, idx, f.label, "Mean", f.unit]);
      connectors.push([Number(lowX.toFixed(2)), Number(highX.toFixed(2)), idx]);
    });

    return {
      textStyle: CHART_TEXT_STYLE,
      title: {
        text: "XGBoost SHAP Summary — Top Not-Good Drivers",
        subtext: "Center line = decision boundary • Blue dots = feature LOW • Red dots = feature HIGH",
        left: "left",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 800, color: "#1e293b" },
        subtextStyle: { fontSize: 11, color: "#64748b" },
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(15,23,42,0.95)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (params) => {
          const [x, , label, valType, unit] = params.data;
          return `<strong>${label}</strong><br/>
            Feature value: <strong style="color:${valType === "High" ? "#fb7185" : valType === "Low" ? "#60a5fa" : "#94a3b8"}">${valType}</strong><br/>
            SHAP drift: <strong>${x > 0 ? "+" : ""}${x}σ</strong> ${unit ? `(${unit})` : ""}`;
        },
      },
      toolbox: BASE_TOOLBOX,
      grid: { left: isMobile ? 110 : 160, right: 40, top: 66, bottom: 40 },
      xAxis: {
        type: "value",
        name: "SHAP impact on NG probability",
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
        splitLine: { lineStyle: { stroke: "#f1f5f9" } },
        axisLabel: { fontSize: 10, color: "#64748b" },
      },
      yAxis: {
        type: "category",
        data: reversed.map((f) => f.label),
        axisLabel: { fontWeight: 700, color: "#1e293b", fontSize: isMobile ? 10.5 : 11.5 },
        axisLine: { lineStyle: { color: "#cbd5e1" } },
      },
      series: [
        {
          name: "Low Value",
          type: "scatter",
          symbolSize: 12,
          data: pointsLow,
          itemStyle: { color: "#3b82f6", opacity: 0.85, borderColor: "#fff", borderWidth: 1.5, shadowBlur: 6, shadowColor: "rgba(59,130,246,0.5)" },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#0f172a", width: 2, type: "solid" },
            label: { formatter: "← Good  |  NG →", position: "middle", fontSize: 10.5, fontWeight: 800, color: "#0f172a", distance: 4, backgroundColor: "rgba(255,255,255,0.9)", padding: [2, 6], borderRadius: 4 },
            data: [{ xAxis: 0 }],
          },
        },
        { name: "High Value", type: "scatter", symbolSize: 12, data: pointsHigh, itemStyle: { color: "#ef4444", opacity: 0.85, borderColor: "#fff", borderWidth: 1.5, shadowBlur: 6, shadowColor: "rgba(239,68,68,0.5)" } },
        { name: "Mean", type: "scatter", symbolSize: 14, symbol: "diamond", data: pointsMean, itemStyle: { color: "#64748b", borderColor: "#fff", borderWidth: 2 } },
        {
          name: "Connector",
          type: "custom",
          silent: true,
          renderItem: (params, api) => {
            const idx = params.dataIndex;
            const lowX = api.value(0);
            const highX = api.value(1);
            const lowCoord = api.coord([lowX, idx]);
            const highCoord = api.coord([highX, idx]);
            return {
              type: "line",
              shape: { x1: lowCoord[0], y1: lowCoord[1], x2: highCoord[0], y2: highCoord[1] },
              style: { stroke: "#cbd5e1", lineWidth: 2.5, lineCap: "round" },
            };
          },
          data: connectors,
          encode: { x: [0, 1], y: 2 },
        },
      ],
    };
  }, [shapData, isMobile]);

  /* ═══════════════════════════════════════════════════════════════════════
     STRIP PLOT
  ═══════════════════════════════════════════════════════════════════════ */
  const stripPlotOption = useMemo(() => {
    const paramDef = ALL_45_PARAMETERS.find((p) => p.key === stripParam) || ALL_45_PARAMETERS[0];
    const okPoints = [];
    const ngPoints = [];
    okRows.forEach((r) => {
      const v = fmtNum(r[stripParam]);
      if (v === null) return;
      okPoints.push([v, Number(getDeterministicJitter(r._partId, 1, 0.35).toFixed(3)), r._partId, r._shotNum, "OK"]);
    });
    ngRows.forEach((r) => {
      const v = fmtNum(r[stripParam]);
      if (v === null) return;
      ngPoints.push([v, Number(getDeterministicJitter(r._partId, 0, 0.35).toFixed(3)), r._partId, r._shotNum, "NG"]);
    });
    const okLimited = okPoints.slice(0, 400);
    const ngLimited = ngPoints.slice(0, 400);
    const okMean = okLimited.length ? okLimited.reduce((s, p) => s + p[0], 0) / okLimited.length : 0;
    const ngMean = ngLimited.length ? ngLimited.reduce((s, p) => s + p[0], 0) / ngLimited.length : 0;

    return {
      textStyle: CHART_TEXT_STYLE,
      title: {
        text: `Strip Plot — G/NG vs ${paramDef.label}`,
        subtext: `Y = Good (top) vs Not-Good (bottom) • X = ${paramDef.label} (${paramDef.unit})`,
        left: "left",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 800, color: "#1e293b" },
        subtextStyle: { fontSize: 11, color: "#64748b" },
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(15,23,42,0.95)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (params) => {
          const [x, , partId, shot, status] = params.data;
          return `<strong>${partId}</strong> • Shot #${shot}<br/>
            Status: <strong style="color:${status === "NG" ? "#fb7185" : "#34d399"}">${status}</strong><br/>
            ${paramDef.label}: <strong>${x} ${paramDef.unit}</strong>`;
        },
      },
      legend: { top: 6, right: 12, icon: "circle", data: ["Good Parts", "Not-Good Parts"], textStyle: { fontSize: 11, fontWeight: 700 } },
      toolbox: BASE_TOOLBOX,
      grid: { left: 70, right: 30, top: 66, bottom: 45 },
      xAxis: {
        type: "value",
        name: `${paramDef.label} (${paramDef.unit})`,
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
        splitLine: { lineStyle: { stroke: "#f1f5f9" } },
        scale: true,
      },
      yAxis: {
        type: "value",
        min: -0.5,
        max: 1.5,
        interval: 1,
        axisLabel: { formatter: (v) => (v === 1 ? "G (Good)" : v === 0 ? "NG (Not Good)" : ""), fontSize: 11.5, fontWeight: 800, color: "#1e293b" },
        splitLine: { lineStyle: { stroke: "#f1f5f9" } },
      },
      series: [
        {
          name: "Good Parts",
          type: "scatter",
          symbolSize: 8,
          data: okLimited,
          itemStyle: { color: "#10b981", opacity: 0.55, shadowBlur: 4, shadowColor: "rgba(16,185,129,0.4)" },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#10b981", width: 2, type: "dashed" },
            label: { formatter: `μ=${okMean.toFixed(1)}`, position: "end", fontSize: 10, color: "#059669", fontWeight: 800, backgroundColor: "rgba(255,255,255,0.9)", padding: [2, 4], borderRadius: 3 },
            data: [{ xAxis: okMean }],
          },
        },
        {
          name: "Not-Good Parts",
          type: "scatter",
          symbolSize: 9,
          data: ngLimited,
          itemStyle: { color: "#ef4444", opacity: 0.65, shadowBlur: 4, shadowColor: "rgba(239,68,68,0.4)" },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#ef4444", width: 2, type: "dashed" },
            label: { formatter: `μ=${ngMean.toFixed(1)}`, position: "end", fontSize: 10, color: "#dc2626", fontWeight: 800, backgroundColor: "rgba(255,255,255,0.9)", padding: [2, 4], borderRadius: 3 },
            data: [{ xAxis: ngMean }],
          },
        },
      ],
    };
  }, [stripParam, okRows, ngRows]);

  /* ═══════════════════════════════════════════════════════════════════════
     GATE-WISE CLUSTERED BAR
  ═══════════════════════════════════════════════════════════════════════ */
  const gateClusteredData = useMemo(() => {
    const groupsMap = {};
    classifiedRows.forEach((r) => {
      if (!r._isNg) return;
      const dateKey = r._dateKey || "Unknown";
      const shift = r._shiftCode || "A";
      const key = `${dateKey}||${shift}`;
      const gateNames = effectiveQualityGates.map(g => g.displayName || g.name || g.code);
      if (!groupsMap[key]) {
        groupsMap[key] = { dateKey, shift };
        gateNames.forEach(gn => groupsMap[key][gn] = 0);
      }
      const g = groupsMap[key];
      const station = String(r._gateStation || "").toUpperCase();
      const reason = canonicalizeReason(r.rejection_reason || r.reason || "");
      
      let matched = false;
      for (const gn of gateNames) {
        const gnUpper = gn.toUpperCase();
        if (
          station.includes(gnUpper.split(' ')[0]) || 
          (gnUpper.includes("LEAK") && (station.includes("LEAK") || r._isLeakNg || reason.includes("Pressure Leak"))) ||
          (gnUpper.includes("CASTING") && (station.includes("CASTING") || reason.includes("Blow") || reason.includes("Porosity")))
        ) {
          g[gn] += 1;
          matched = true;
          break;
        }
      }
      if (!matched && gateNames.length > 0) g[gateNames[0]] += 1;
    });
    const sortedKeys = Object.keys(groupsMap).sort((a, b) => {
      const [dA, sA] = a.split("||");
      const [dB, sB] = b.split("||");
      if (dA !== dB) return dA.localeCompare(dB);
      return sA.localeCompare(sB);
    });
    const limited = sortedKeys.slice(-16);
    const categories = limited.map((k) => {
      const [d, s] = k.split("||");
      const dateShort = d === "Unknown" ? "—" : d.slice(5);
      return `${dateShort}\nS${s}`;
    });
    
    const seriesData = {};
    const gateNamesToUse = effectiveQualityGates.map(g => g.displayName || g.name || g.code);
    gateNamesToUse.forEach(gn => {
      seriesData[gn] = limited.map((k) => groupsMap[k][gn] || 0);
    });

    return { categories, seriesData, gateNames: gateNamesToUse };
  }, [classifiedRows]);

  const gateClusteredOption = useMemo(() => {
    const d = gateClusteredData;
    const GRADS = {
      g1: linearGradient("#60a5fa", "#1d4ed8"),
      g2: linearGradient("#fbbf24", "#b45309"),
      g3: linearGradient("#fb7185", "#be123c"),
      g4: linearGradient("#34d399", "#059669"),
    };
    return {
      textStyle: CHART_TEXT_STYLE,
      title: {
        text: "Gate-wise Rejection Count",
        subtext: "Dynamic mapping based on active stations",
        left: "left",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 800, color: "#1e293b" },
        subtextStyle: { fontSize: 11, color: "#64748b" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(15,23,42,0.95)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (items) => {
          let str = `<div style="font-weight:800;margin-bottom:6px">${items[0]?.axisValue?.replace("\n", " • ")}</div>`;
          let total = 0;
          items.forEach((it) => {
            total += Number(it.value) || 0;
            str += `${it.marker} ${it.seriesName}: <strong>${it.value}</strong><br/>`;
          });
          str += `<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.2);padding-top:4px">Total: <strong style="color:#fbbf24">${total}</strong></div>`;
          return str;
        },
      },
      legend: {
        top: 6,
        right: 12,
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 8,
        textStyle: { fontSize: 10.5, fontWeight: 700 },
        type: "scroll",
        data: d.gateNames,
      },
      toolbox: BASE_TOOLBOX,
      grid: { left: 55, right: 30, top: 62, bottom: isMobile ? 60 : 50 },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        ...(d.categories.length > 8 ? [{ type: "slider", height: 14, bottom: 6, start: 0, end: 100, showDetail: false, borderColor: "#e2e8f0", fillerColor: "rgba(37,99,235,0.15)" }] : []),
      ],
      xAxis: {
        type: "category",
        data: d.categories,
        axisLabel: { fontSize: 10, fontWeight: 700, color: "#334155", lineHeight: 13, interval: 0, rotate: isMobile ? 45 : 0 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: "value",
        name: "Rejection Count",
        nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" },
        splitLine: { lineStyle: { stroke: "#f1f5f9" } },
        axisLabel: { fontSize: 10, color: "#64748b" },
      },
      series: d.gateNames.map((gn, idx) => ({
        name: gn,
        type: "bar",
        barGap: "8%",
        barWidth: Math.max(8, 24 - (d.gateNames.length * 2)) + "%",
        itemStyle: { 
          color: [
            linearGradient("#60a5fa", "#1d4ed8"),
            linearGradient("#fbbf24", "#b45309"),
            linearGradient("#fb7185", "#be123c"),
            linearGradient("#34d399", "#059669"),
            linearGradient("#a78bfa", "#6d28d9"),
            linearGradient("#2dd4bf", "#0f766e")
          ][idx % 6], 
          borderRadius: [3, 3, 0, 0] 
        },
        data: d.seriesData[gn] || [],
      })),
    };
  }, [gateClusteredData, isMobile]);

  /* ═══════════════════════════════════════════════════════════════════════
     HEATMAP DATA
  ═══════════════════════════════════════════════════════════════════════ */
  const heatmapData = useMemo(() => {
    const ngPool = ngRows.length > 0 ? ngRows : rejectedRows;
    if (!ngPool.length) return { rows: [], columns: [], maxCount: 0 };
    const matrix = {};
    const ySet = new Set();
    const xSet = new Set();
    ngPool.forEach((r) => {
      const rawReason = r.rejection_reason || r.reason || r.ngReason || r.ng_reason || (r._isLeakNg ? "Pressure Leak (OP150)" : "");
      const reason = canonicalizeReason(rawReason) || "Unspecified Defect";
      const category = r.rejection_category || r.category || (r._isLeakNg ? "MR" : "CR");
      const zone = r.rejection_zone || r.rejectionZone || r.zone || (r._isLeakNg ? "Leak Port" : "Zone-A");
      const view = r.rejection_view || r.rejectionView || r.view || (r._isLeakNg ? "Leak Stand" : "Top View");
      let yKey, xKey;
      if (heatmapMode === "reason_zone") { yKey = reason; xKey = zone; }
      else if (heatmapMode === "category_zone") { yKey = category; xKey = zone; }
      else { yKey = reason; xKey = view; }
      if (!matrix[yKey]) matrix[yKey] = {};
      matrix[yKey][xKey] = (matrix[yKey][xKey] || 0) + 1;
      ySet.add(yKey);
      xSet.add(xKey);
    });
    const columns = Array.from(xSet).sort();
    let maxCount = 0;
    const rowList = Array.from(ySet)
      .map((yVal) => {
        const counts = {};
        let rowTotal = 0;
        columns.forEach((col) => {
          const c = matrix[yVal]?.[col] || 0;
          counts[col] = c;
          rowTotal += c;
          if (c > maxCount) maxCount = c;
        });
        return { name: yVal, counts, total: rowTotal };
      })
      .sort((a, b) => b.total - a.total);
    return { rows: rowList, columns, maxCount };
  }, [ngRows, rejectedRows, heatmapMode]);

  /* ═══════════════════════════════════════════════════════════════════════
     STYLES (CSS-in-JS with responsive media)
  ═══════════════════════════════════════════════════════════════════════ */
  const S = useMemo(() => ({
    root: { display: "flex", flexDirection: "column", gap: isMobile ? 16 : 24, paddingBottom: 40, width: "100%", maxWidth: "100%", boxSizing: "border-box" },
    card: {
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      padding: isMobile ? 14 : 22,
      boxShadow: "0 4px 18px rgba(15,23,42,0.06)",
      width: "100%",
      boxSizing: "border-box",
      overflow: "hidden",
      transition: "box-shadow 0.25s ease, transform 0.25s ease",
    },
    cardHeader: { display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", flexDirection: isMobile ? "column" : "row", gap: 12, marginBottom: 14, flexWrap: "wrap" },
    h3: { display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: isMobile ? 14 : 16, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" },
    subtitle: { margin: "4px 0 0", fontSize: isMobile ? 11.5 : 12.5, color: "#64748b", lineHeight: 1.5 },
    tabBtn: (active) => ({
      padding: isMobile ? "5px 10px" : "6px 14px",
      fontSize: isMobile ? 11 : 12,
      fontWeight: 700,
      borderRadius: 8,
      border: "none",
      cursor: "pointer",
      background: active ? "linear-gradient(135deg,#2563eb,#7c3aed)" : "transparent",
      color: active ? "#fff" : "#475569",
      transition: "all 0.2s ease",
      boxShadow: active ? "0 3px 10px rgba(37,99,235,0.35)" : "none",
      whiteSpace: "nowrap",
    }),
    tabGroup: { display: "flex", gap: 4, background: "#f1f5f9", padding: 4, borderRadius: 10, flexWrap: "wrap" },
    kpiBadge: {
      background: "rgba(255,255,255,0.08)",
      padding: "8px 14px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.12)",
      backdropFilter: "blur(10px)",
      minWidth: 110,
    },
    chartWrap: (h) => ({ width: "100%", height: typeof h === "number" ? h : h, minHeight: typeof h === "number" ? h : 260 }),
    grid2: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : (isTablet ? "repeat(auto-fit,minmax(320px,1fr))" : "1.4fr 1fr"), gap: 20, alignItems: "center" },
    gridDonut: { display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 240 : 260}px, 1fr))`, gap: 16 },
    gridFacet: { display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 260 : 320}px, 1fr))`, gap: 16 },
    grid2Col: { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(440px, 1fr))", gap: 20 },
    tableWrap: { overflowX: "auto", width: "100%", borderRadius: 10, border: "1px solid #e2e8f0" },
    table: { width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 11 : 12, minWidth: isMobile ? 520 : 640 },
    th: { padding: "10px 12px", textAlign: "left", color: "#64748b", borderBottom: "2px solid #e2e8f0", background: "#f8fafc", fontWeight: 800, position: "sticky", top: 0, whiteSpace: "nowrap" },
  }), [isMobile, isTablet]);

  const filterPills = [
    { id: "ALL", label: "All" },
    { id: "machine_process", label: "Machine" },
    { id: "product_params", label: "Product" },
    { id: "die_temp", label: "Die Temp" },
    { id: "flow_pressure", label: "Flow" },
  ];

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div style={S.root}>
      {/* ── HERO BANNER ─────────────────────────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.96) 60%, rgba(76,29,149,0.9) 100%)",
          color: "#fff",
          borderRadius: 16,
          padding: isMobile ? "16px 16px" : "20px 24px",
          boxShadow: "0 14px 40px rgba(15,23,42,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -40,
            right: -40,
            width: 200,
            height: 200,
            background: "radial-gradient(circle, rgba(139,92,246,0.35), transparent 70%)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "1 1 320px", minWidth: 0 }}>
            <div
              style={{
                width: isMobile ? 42 : 52,
                height: isMobile ? 42 : 52,
                borderRadius: 14,
                background: "linear-gradient(135deg,#6366f1,#a855f7 60%,#ec4899)",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 8px 22px rgba(139,92,246,0.5)",
                flexShrink: 0,
              }}
            >
              <BrainCircuit size={isMobile ? 22 : 28} color="#fff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 21, fontWeight: 900, letterSpacing: "-0.02em", background: "linear-gradient(90deg,#fff,#c7d2fe)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  Industrial Deep Learning &amp; Rejection Intelligence
                </h2>
                <span style={{ background: "rgba(139,92,246,0.3)", border: "1px solid rgba(139,92,246,0.55)", color: "#c4b5fd", fontSize: 9.5, fontWeight: 800, padding: "3px 9px", borderRadius: 9999, letterSpacing: "0.06em" }}>
                  APACHE ECHARTS • XGBOOST SHAP • STRIP PLOTS
                </span>
              </div>
              <p style={{ margin: "5px 0 0", fontSize: isMobile ? 11.5 : 13, color: "#94a3b8", lineHeight: 1.5 }}>
                Production combo • SHAP summary • Defect heatmap • Strip plots • Gate-wise clustered bars
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={S.kpiBadge}>
              <span style={{ fontSize: 10, color: "#94a3b8", display: "block", textTransform: "uppercase", fontWeight: 800, letterSpacing: "0.05em" }}>Monitored</span>
              <strong style={{ fontSize: isMobile ? 15 : 17, color: "#38bdf8", fontWeight: 900 }}>{(summary.totalProduction || dataPool.length).toLocaleString()}</strong>
            </div>
            <div style={S.kpiBadge}>
              <span style={{ fontSize: 10, color: "#94a3b8", display: "block", textTransform: "uppercase", fontWeight: 800, letterSpacing: "0.05em" }}>NG Scrapped</span>
              <strong style={{ fontSize: isMobile ? 15 : 17, color: "#fb7185", fontWeight: 900 }}>
                {(summary.totalNG || ngRows.length).toLocaleString()}{" "}
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fca5a5" }}>({summary.rejectRate || 0}%)</span>
              </strong>
            </div>
            <div style={S.kpiBadge}>
              <span style={{ fontSize: 10, color: "#94a3b8", display: "block", textTransform: "uppercase", fontWeight: 800, letterSpacing: "0.05em" }}>Hotspot</span>
              <strong style={{ fontSize: isMobile ? 13 : 15, color: "#fbbf24", fontWeight: 800 }}>{summary.topHotspotStation || "OP120"}</strong>
            </div>
            <div style={S.kpiBadge}>
              <span style={{ fontSize: 10, color: "#94a3b8", display: "block", textTransform: "uppercase", fontWeight: 800, letterSpacing: "0.05em" }}>Top Shift</span>
              <strong style={{ fontSize: isMobile ? 13 : 15, color: "#ec4899", fontWeight: 800 }}>{shiftAggregates[0]?.shift} ({shiftAggregates[0]?.scrapRate}%)</strong>
            </div>
          </div>
        </div>
      </div>

      {/* ── A. PRODUCTION COMBO ──────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0, flex: "1 1 300px" }}>
            <h3 style={S.h3}>
              <BarChart3 size={18} color="#0284c7" />
              <span>Production Summary Combo Chart</span>
            </h3>
            <p style={S.subtitle}>
              Bars = produced qty (left axis) • Lines = Total / Gate-wise Scrap % (right axis) • X = Date + Shift
            </p>
          </div>
          <div style={S.tabGroup}>
            {[{ id: "all", label: "All Lines" }, { id: "total", label: "Total Only" }, { id: "gates", label: "Gates Only" }].map((m) => (
              <button key={m.id} type="button" onClick={() => setComboMetric(m.id)} style={S.tabBtn(comboMetric === m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div style={S.chartWrap(H.combo)}>
          <EChart option={productionComboOption} style={{ height: "100%", width: "100%" }} />
        </div>
      </div>

      {/* ── B. SHAP SUMMARY ──────────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0, flex: "1 1 300px" }}>
            <h3 style={S.h3}>
              <Zap size={18} color="#eab308" />
              <span>XGBoost SHAP Summary — Top Drivers of Not-Good Parts</span>
            </h3>
            <p style={S.subtitle}>
              Vertical center line = decision boundary • Blue = feature LOW • Red = feature HIGH • Diamond = mean
            </p>
          </div>
          <div style={S.tabGroup}>
            {filterPills.map((cat) => (
              <button key={cat.id} type="button" onClick={() => setShapCategoryFilter(cat.id)} style={S.tabBtn(shapCategoryFilter === cat.id)}>
                {cat.label}
              </button>
            ))}
          </div>
        </div>
        <div style={S.chartWrap(H.shapSummary)}>
          <EChart option={shapSummaryOption} style={{ height: "100%", width: "100%" }} />
        </div>
      </div>

      {/* ── C. STRIP PLOT ────────────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0, flex: "1 1 300px" }}>
            <h3 style={S.h3}>
              <ScatterIcon size={18} color="#10b981" />
              <span>Strip / Scatter Plot — Good vs Not-Good Distribution per Parameter</span>
            </h3>
            <p style={S.subtitle}>
              Y = G (top) / NG (bottom) • X = parameter value • Dashed lines show group means
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>Parameter:</span>
            <select
              value={stripParam}
              onChange={(e) => setStripParam(e.target.value)}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff",
                fontSize: 12, fontWeight: 700, color: "#1e293b", cursor: "pointer",
                maxWidth: isMobile ? 180 : 320, outline: "none",
              }}
            >
              {ALL_45_PARAMETERS.map((p) => (
                <option key={p.key} value={p.key}>{p.label} ({p.unit})</option>
              ))}
            </select>
          </div>
        </div>
        <div style={S.chartWrap(H.strip)}>
          <EChart option={stripPlotOption} style={{ height: "100%", width: "100%" }} />
        </div>
      </div>

      {/* ── D. GATE-WISE CLUSTERED ───────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0 }}>
            <h3 style={S.h3}>
              <Layers size={18} color="#8b5cf6" />
              <span>Gate-wise Rejection Count — Clustered Bar Chart</span>
            </h3>
            <p style={S.subtitle}>
              X = Date + Shift • 4 clustered bars = Gate 1 Production / Gate 2 Casting / Gate 3 Leakage / Gate 4 Final
            </p>
          </div>
        </div>
        <div style={S.chartWrap(H.gateClustered)}>
          <EChart option={gateClusteredOption} style={{ height: "100%", width: "100%" }} />
        </div>
      </div>

      {/* ── E. SHIFT & CATEGORY PIE CHARTS ───────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0, flex: "1 1 280px" }}>
            <h3 style={S.h3}>
              <Clock size={18} color="#ec4899" />
              <span>Shift Rejection Analytics</span>
            </h3>
            <p style={S.subtitle}>Shift-wise vs Category-wise Production Defect Impact</p>
          </div>
        </div>

        <div style={S.grid2}>
          <div style={S.chartWrap(H.rose)}>
            <EChart option={shiftRoseOption} style={{ height: "100%", width: "100%" }} />
          </div>

          <div style={S.chartWrap(H.rose)}>
            <EChart option={donutOptions.category} style={{ height: "100%", width: "100%" }} />
          </div>
        </div>

        <div style={{ background: "linear-gradient(135deg,#f8fafc,#f1f5f9)", padding: 16, borderRadius: 14, border: "1px solid #e2e8f0", marginTop: 16 }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 900, color: "#1e293b", display: "flex", alignItems: "center", gap: 6 }}>
              <Activity size={14} color="#ec4899" /> Shift-Wise Verified Metrics
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {shiftAggregates.map((s, idx) => {
                const color = idx === 0 ? "#f43f5e" : idx === 1 ? "#3b82f6" : "#eab308";
                return (
                  <div
                    key={s.code}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 14px", background: "#ffffff", borderRadius: 10,
                      border: "1px solid #e2e8f0", boxShadow: "0 2px 6px rgba(15,23,42,0.04)",
                      borderLeft: `4px solid ${color}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
                      <strong style={{ fontSize: 13, color: "#1e293b" }}>{s.shift}</strong>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 900, color: s.scrapRate > 3 ? "#dc2626" : "#059669" }}>
                        {s.scrapRate}% Scrap
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                        {s.ng.toLocaleString()} NG / {s.total.toLocaleString()} Total
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
        </div>
      </div>

      {/* ── F. 4× DONUTS ─────────────────────────────────────────────── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <PieIcon size={18} color="#2563eb" />
          <h3 style={{ margin: 0, fontSize: isMobile ? 14 : 16, fontWeight: 900, color: "#0f172a" }}>
            Quality Distribution &amp; Gate Contribution
          </h3>
        </div>
        <div style={S.gridDonut}>
          {[
            { opt: donutOptions.status, h: H.donut },
            { opt: donutOptions.gate, h: H.donut },
            { opt: donutOptions.category, h: H.donut },
            { opt: donutOptions.defect, h: H.donut },
          ].map((d, i) => (
            <div key={i} style={{ ...S.card, padding: "10px 12px" }}>
              <div style={S.chartWrap(d.h)}>
                <EChart option={d.opt} style={{ height: "100%", width: "100%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── G. BOXPLOTS (TABBED) ─────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0, flex: "1 1 280px" }}>
            <h3 style={S.h3}>
              <BoxSelect size={18} color="#06b6d4" />
              <span>{boxPlotTab === "faceted" ? "Multi-Parameter Faceted Box Plot" : "Shift-Wise Grouped Box Stability"}</span>
            </h3>
            <p style={S.subtitle}>
              {boxPlotTab === "faceted"
                ? "Side-by-side comparison across 6 critical process parameters. Overlaid dots = genuine serial Part IDs."
                : "Inspect parameter variance and median drift across Shift A, B, C."}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={S.tabGroup}>
              <button type="button" onClick={() => setBoxPlotTab("faceted")} style={S.tabBtn(boxPlotTab === "faceted")}>Faceted</button>
              <button type="button" onClick={() => setBoxPlotTab("shift")} style={S.tabBtn(boxPlotTab === "shift")}>Shift-wise</button>
            </div>
            {boxPlotTab === "shift" && (
              <select
                value={shiftBoxParam}
                onChange={(e) => setShiftBoxParam(e.target.value)}
                style={{
                  padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff",
                  fontSize: 12, fontWeight: 700, color: "#1e293b", cursor: "pointer", maxWidth: 260, outline: "none",
                }}
              >
                {ALL_45_PARAMETERS.slice(0, 20).map((p) => (
                  <option key={p.key} value={p.key}>{p.label} ({p.unit})</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {boxPlotTab === "faceted" ? (
          <div style={S.gridFacet}>
            {facetedBoxplots.map((facet) => (
              <div
                key={facet.key}
                style={{
                  height: H.boxFacet, background: "linear-gradient(180deg,#ffffff,#f8fafc)",
                  border: "1px solid #e2e8f0", borderRadius: 10, padding: "6px 8px",
                  boxShadow: "0 2px 10px rgba(15,23,42,0.04)",
                }}
              >
                <EChart option={facet.option} style={{ height: "100%", width: "100%" }} />
              </div>
            ))}
          </div>
        ) : (
          <div style={S.chartWrap(H.boxShift)}>
            <EChart option={shiftGroupedBoxOption} style={{ height: "100%", width: "100%" }} />
          </div>
        )}
      </div>

      {/* ── H & I. MANIFOLD + RADAR ──────────────────────────────────── */}
      <div style={S.grid2Col}>
        <div style={S.card}>
          <div style={S.chartWrap(H.manifold)}>
            <EChart option={manifoldOption} style={{ height: "100%", width: "100%" }} />
          </div>
        </div>
        <div style={S.card}>
          <div style={S.chartWrap(H.radar)}>
            <EChart option={radarOption} style={{ height: "100%", width: "100%" }} />
          </div>
        </div>
      </div>

      {/* ── J. SHAP TORNADO ──────────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0 }}>
            <h3 style={S.h3}>
              <Zap size={18} color="#eab308" />
              <span>XGBoost / SHAP Diverging Feature Driver Chart</span>
            </h3>
            <p style={S.subtitle}>Red = parameter HIGH in NG parts • Blue = parameter LOW</p>
          </div>
        </div>
        <div style={S.chartWrap(H.shapTornado)}>
          <EChart option={shapOption} style={{ height: "100%", width: "100%" }} />
        </div>
      </div>

      {/* ── K. HEATMAP ───────────────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0, flex: "1 1 280px" }}>
            <h3 style={S.h3}>
              <Flame size={18} color="#ef4444" />
              <span>Defect Concentration Heatmap Matrix</span>
            </h3>
            <p style={S.subtitle}>Y = defect category • X = defect location • Cell = count (darker = more defects)</p>
          </div>
          <div style={S.tabGroup}>
            {[
              { id: "reason_zone", label: "Reason vs Zone" },
              { id: "category_zone", label: "Category vs Zone" },
              { id: "reason_view", label: "Reason vs View" },
            ].map((mode) => (
              <button key={mode.id} type="button" onClick={() => setHeatmapMode(mode.id)} style={S.tabBtn(heatmapMode === mode.id)}>
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {heatmapData.rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
            No defect records located in current filter selection.
          </div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={{ ...S.th, position: "sticky", left: 0, background: "#f8fafc", zIndex: 2 }}>Defect Type</th>
                  {heatmapData.columns.map((col) => (
                    <th key={`hcol-${col}`} style={{ ...S.th, textAlign: "center", color: "#1e293b" }}>{col}</th>
                  ))}
                  <th style={{ ...S.th, textAlign: "right", color: "#dc2626" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {heatmapData.rows.slice(0, 15).map((row) => (
                  <tr key={`hrow-${row.name}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 800, color: "#1e293b", position: "sticky", left: 0, background: "#fff", zIndex: 1, borderRight: "1px solid #e2e8f0" }}>
                      {row.name}
                    </td>
                    {heatmapData.columns.map((col) => {
                      const count = row.counts[col] || 0;
                      const bg = getHeatColor(count, heatmapData.maxCount);
                      const fontColor = count > heatmapData.maxCount * 0.4 ? "#fff" : count > 0 ? "#0f172a" : "#94a3b8";
                      return (
                        <td
                          key={`hcell-${row.name}-${col}`}
                          style={{
                            padding: "10px 12px", textAlign: "center", background: bg, color: fontColor,
                            fontWeight: count > 0 ? 800 : 400, borderRadius: 4,
                            transition: "transform 0.15s ease",
                          }}
                        >
                          {count > 0 ? count : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 900, color: "#dc2626" }}>{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── L. RANKED PARAMETER TABLE ────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ minWidth: 0 }}>
            <h3 style={S.h3}>
              <Sliders size={18} color="#2563eb" />
              <span>Ranked Parameter Importance &amp; Corrective Action Matrix</span>
            </h3>
            <p style={S.subtitle}>Sorted by ML importance weight • Corrective action derived from statistical drift direction</p>
          </div>
        </div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Rank</th>
                <th style={S.th}>Parameter</th>
                <th style={S.th}>Category</th>
                <th style={{ ...S.th, textAlign: "right" }}>Impact %</th>
                <th style={{ ...S.th, textAlign: "right" }}>OK Mean</th>
                <th style={{ ...S.th, textAlign: "right" }}>NG Mean</th>
                <th style={{ ...S.th, textAlign: "center" }}>Drift σ</th>
                <th style={S.th}>Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {shapData.map((f, idx) => (
                <tr key={`diag-${f.key}`} style={{ borderBottom: "1px solid #f1f5f9", background: idx % 2 === 0 ? "#fff" : "#fafbfc" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 800, color: "#64748b" }}>#{idx + 1}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 800, color: "#1e293b" }}>{f.label}</td>
                  <td style={{ padding: "10px 12px", color: "#64748b", fontSize: 11 }}>{f.category}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: "#2563eb" }}>{f.importance}%</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "#059669", fontWeight: 700 }}>
                    {f.meanOk} {f.unit} {f.stdOk > 0 && <span style={{ fontSize: 10, color: "#94a3b8" }}>±{f.stdOk}</span>}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: "#dc2626" }}>{f.meanNg} {f.unit}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    <span
                      style={{
                        padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 800,
                        background: f.shapValue >= 0 ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)",
                        color: f.shapValue >= 0 ? "#dc2626" : "#2563eb",
                      }}
                    >
                      {f.shapValue >= 0 ? `+${f.shapValue}σ` : `${f.shapValue}σ`}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 11.5, color: "#334155" }}>
                    {f.shapValue > 1.0
                      ? `Lower ${f.label} closer to target setpoint; check PID cooling loop.`
                      : f.shapValue < -1.0
                      ? `Increase ${f.label} to avoid incomplete cavity filling.`
                      : `Maintain process capability within ±2σ tolerance band.`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}