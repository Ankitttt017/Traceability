import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  AlertTriangle,
  Sliders,
  RefreshCw,
  FileSpreadsheet,
  BarChart3,
  Layers,
  Sparkles,
  Activity,
  ListFilter,
  Flame,
  TrendingUp,
  Calendar,
  ChevronDown,
  X,
  CheckCircle2,
  Clock,
  Database,
  Wifi,
  WifiOff,
  Filter,
  Download,
} from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { dashboardApi, machineApi, rejectionConfigApi, organizationApi } from "../../api/services";
import DateRangePicker from "./components/DateRangePicker";
import MasterRecipeModal from "./components/MasterRecipeModal";
import QualityGatesTab from "./QualityGatesTab";
import RejectionKpiStrip from "./RejectionKpiStrip";
import RootCauseTab from "./RootCauseTab";
import DieWiseTab from "./DieWiseTab";
import HeatMapTab from "./HeatMapTab";
import TelemetryTab from "./TelemetryTab";
import ScrapRecordsTab from "./ScrapRecordsTab";
import {
  MACHINE_PROCESS_PARAMETERS,
  PRODUCT_PARAMETERS,
  FLOW_PRESSURE_PARAMETERS,
  DIE_TEMPERATURE_PARAMETERS,
  ALL_45_PARAMETERS,
  MASTER_RECIPE_SET_PARAMETERS,
  ALL_TELEMETRY_CATEGORIES,
  looksLikeCustomerQr,
  fmtNum,
  extractShotFromPartId,
  extractShotDateTimeFromPartId,
  formatResultTimestamp,
} from "./rejectionConstants";
import "./RejectionAnalysis.css";
import { ChartDownloadProvider } from "../../components/charts/chartDownload";

/* Re-export parameter definitions for backwards compatibility */
export {
  MACHINE_PROCESS_PARAMETERS,
  PRODUCT_PARAMETERS,
  FLOW_PRESSURE_PARAMETERS,
  DIE_TEMPERATURE_PARAMETERS,
  ALL_45_PARAMETERS,
  MASTER_RECIPE_SET_PARAMETERS,
  ALL_TELEMETRY_CATEGORIES,
};

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS & HELPERS
   ───────────────────────────────────────────────────────────────────────────── */

const relativeTime = (date) => {
  if (!date) return "—";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const TAB_DEFS = [
  { key: "overview",           label: "Station Overview",   icon: BarChart3,   color: "#2563eb" },
  { key: "die_analysis",       label: "Die Performance",    icon: Layers,      color: "#059669" },
  { key: "ml_analysis",        label: "Root Cause Analysis", icon: Sparkles,    color: "#8b5cf6" },
  { key: "telemetry",          label: "Process Monitoring (SPC)", icon: Activity,    color: "#0ea5e9" },
  { key: "records",            label: "Scrap Records",      icon: ListFilter,  color: "#d97706" },
  { key: "heat_map",           label: "Defect Location Map", icon: Flame,       color: "#ef4444" },

];

/* Dates are production days (the server counts each date from Shift A start to the next day's Shift A start, so
   the night shift stays on the date it started). The button only shows the selected dates, like the Report page. */
const DAY_START_HOUR = 6;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The production day running at `now`: before Shift A starts it is still yesterday's production day. */
const productionToday = (now = new Date()) => new Date(now.getTime() - DAY_START_HOUR * 3600 * 1000);
const fmtDay = (d) => `${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]} ${d.getFullYear()}`;
/** "05 Oct 2026" for one day, "01 Oct 2026 – 05 Oct 2026" for a range. */
const selectedDatesLabel = (fromDay, toDay) => {
  const p = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
  const a = p(fromDay), b = p(toDay || fromDay);
  if (!a || !b) return "";
  return a.getTime() === b.getTime() ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;
};

const DATE_PRESETS = [
  { value: "last90",    label: "Last 90 Days" },
  { value: "last30",    label: "Last 30 Days" },
  { value: "last7",     label: "Last 7 Days" },
  { value: "today",     label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "all",       label: "All Time" },
  { value: "custom",    label: "Custom Range" },
];

/* ═════════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═════════════════════════════════════════════════════════════════════════════ */
export default function RejectionAnalysis() {
  /* ── State ─────────────────────────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [, forceTick] = useState(0); // for live "Updated X ago"

  /* Filters */
  const getLocalISODate = (d) => {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 10);
  };

  const [filters, setFilters] = useState(() => {
    const now = productionToday();
    const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      dateFrom: getLocalISODate(past30),
      dateTo: getLocalISODate(now),
      datePreset: "last30",
      shiftCode: "",
      machineName: "",
      qualityGate: "",
      partName: "",
      partCategory: "",
      dieName: "",
      status: "ALL",
    };
  });

  /* Summary + core data */
  const [summary, setSummary] = useState({
    totalProduction: 0,
    totalOK: 0,
    totalNG: 0,
    inProgress: 0,
    rejectRate: 0,
    topHotspotStation: "Evaluating...",
    topDriverParameter: "Evaluating...",
  });

  const [qualityGates, setQualityGates] = useState([]);
  const [isOp150Grouped, setIsOp150Grouped] = useState(false);
  const [stationLabels, setStationLabels] = useState({
    OP100: "DCM+DPM + OP100",
    OP110: "Laser Marking + OP110",
    OP120: "Casting PDi + OP120",
    OP130: "Pre Inspection + OP130",
    OP140: "Auto Guaging + OP140",
    OP150: "Leak Test OP150",
    "Leak-Test-01": "Leak-Test-1 (OP150)",
    "Leak-Test-02": "Leak-Test-2 (OP150)",
    "Leak Test-03": "Leak-Test-3 (OP150)",
    OP160: "Final Inspection + OP160",
  });

  const [mlInsights, setMlInsights] = useState({ features: [], topAnomalies: [] });
  const [pareto, setPareto] = useState([]);
  const [categoryParetoData, setCategoryParetoData] = useState([]);
  const [zoneParetoData, setZoneParetoData] = useState([]);
  const [shiftScrap, setShiftScrap] = useState([]);
  const [rows, setRows] = useState([]);
  const [dieStats, setDieStats] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ machines: [], parts: [], dies: [], shifts: [] });
  const [dataErrors, setDataErrors] = useState([]);
  const [qualityGateDrillDown, setQualityGateDrillDown] = useState({});
  const [rejectionConfig, setRejectionConfig] = useState(null);

  /* Records */
  const [recordsRows, setRecordsRows] = useState([]);
  // Every NG record in the filter window (gate, category, reason, view, zone, sub-zone + PLC readings)
  const [ngRecords, setNgRecords] = useState([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize, setRecordsPageSize] = useState(100);
  const [recordsLoading, setRecordsLoading] = useState(false);

  /* Master Recipe Modal */
  const [showSetParamsModal, setShowSetParamsModal] = useState(false);

  /* Date picker popover */
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef(null);

  /* Export button state */
  const [exportState, setExportState] = useState("idle"); // idle | loading | success | error
  const [exportMessage, setExportMessage] = useState("");

  /* ── Live "Updated X ago" ticker ──────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  /* ── Close date picker on outside click ──────────────────────────────── */
  useEffect(() => {
    if (!showDatePicker) return;
    const onClick = (e) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showDatePicker]);

  /* ── Toast auto-dismiss for export ───────────────────────────────────── */
  useEffect(() => {
    if (exportState === "success" || exportState === "error") {
      const t = setTimeout(() => {
        setExportState("idle");
        setExportMessage("");
      }, 3500);
      return () => clearTimeout(t);
    }
  }, [exportState]);

  /* ── Dynamic Machines & Dies Setup ────────────────────────────────────── */
  useEffect(() => {
    // lookup lists with fallbacks: a slow answer must not raise the global "Server timeout" toast
    const LOOKUP = { timeout: 60000, suppressGlobalError: true };
    machineApi.list(LOOKUP)
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.data || []);
        if (list.length > 0) {
          const machineNames = [...new Set(list.map((m) => m.machine_name).filter(Boolean))];
          setFilterOptions((prev) => ({
            ...prev,
            machines: [...new Set([...(prev.machines || []), ...machineNames])],
          }));

          const dynamicLabels = {};
          list.forEach((m) => {
            const op = String(m.operation_no || "").trim().toUpperCase();
            const mName = String(m.machine_name || "").trim();
            if (op && mName) {
              if (op === "OP150" && mName.toLowerCase().includes("leak")) {
                dynamicLabels["OP150"] = "Leak Test OP150";
              } else {
                dynamicLabels[op] = `${mName} + ${op}`;
              }
            }
          });
          setStationLabels((prev) => ({ ...prev, ...dynamicLabels }));
        }
      })
      .catch((err) => console.warn("[REJECTION UI] machineApi.list fallback:", err.message));

    organizationApi.listParts({}, LOOKUP)
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.data || []);
        if (list.length > 0) {
          const distinctDies = [...new Set(list.map((p) => p.dieName).filter(Boolean))];
          setFilterOptions((prev) => ({
            ...prev,
            dies: [...new Set([...(prev.dies || []), ...distinctDies])].sort(),
          }));
        }
      })
      .catch((err) => console.warn("[REJECTION UI] organizationApi.listParts fallback:", err.message));
  }, []);

  /* ── Load Rejection Config ────────────────────────────────────────────── */
  useEffect(() => {
    rejectionConfigApi.operatorConfig({ partName: "OIL PAN K-12" }, { timeout: 60000, suppressGlobalError: true })
      .then((res) => {
        if (res && res.views) setRejectionConfig(res);
      })
      .catch((err) => console.warn("[REJECTION UI] operatorConfig fallback:", err.message));
  }, []);

  /* ── Load Data from Modular APIs ──────────────────────────────────────── */
  // Progressive, tab-wise loading (one wave at a time, so the server never gets every heavy query at once):
  //  1. summary / Pareto / shift (fast)          → the page renders
  //  2. NG part records                          → drill-downs, die, location map, scrap records
  //  3. process data + ML insights (≈3 MB)       → only when Root Cause or SPC is opened (see loadMlInsights)
  // OK part records are not loaded: no tab uses them (they were ~6 MB for 30 days). A newer request makes older
  // answers stale.
  const buildQuery = useCallback(() => {
    const query = { limit: 5000, noCache: "1", _ts: Date.now() };
    if (filters.datePreset) query.datePreset = filters.datePreset;
    if (filters.datePreset === "all") query.allTime = "1";
    if (filters.dateFrom) query.dateFrom = filters.dateFrom;
    if (filters.dateTo) query.dateTo = filters.dateTo;
    if (filters.shiftCode) query.shiftCode = filters.shiftCode;
    if (filters.machineName) query.machineName = filters.machineName;
    if (filters.qualityGate) query.qualityGate = filters.qualityGate;
    if (filters.partName) query.partName = filters.partName;
    if (filters.partCategory) query.partCategory = filters.partCategory;
    if (filters.dieName) query.dieName = filters.dieName;
    if (filters.status && filters.status !== "ALL") query.status = filters.status;
    return query;
  }, [filters]);
  const loadSeqRef = useRef(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const loadData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const isCurrent = () => seq === loadSeqRef.current;
    setLoading(true);
    setDataErrors([]);
    try {
      const query = buildQuery();

      const errors = [];

      const [summaryResult, paretoResult, shiftResult] = await Promise.allSettled([
        dashboardApi.rejectionSummary(query, { timeout: 60000, suppressGlobalError: true }),
        dashboardApi.rejectionPareto(query, { timeout: 60000, suppressGlobalError: true }),
        dashboardApi.rejectionShiftScrap(query, { timeout: 60000, suppressGlobalError: true }),
      ]);
      if (!isCurrent()) return;

      if (summaryResult.status === "fulfilled" && summaryResult.value) {
        const res = summaryResult.value;
        if (res.summary) setSummary(res.summary);
        if (Array.isArray(res.qualityGates)) setQualityGates(res.qualityGates);
        if (Array.isArray(res.dieStats)) setDieStats(res.dieStats);
        if (res.filterOptions) setFilterOptions(res.filterOptions);
        if (res.stationLabels) setStationLabels((prev) => ({ ...prev, ...res.stationLabels }));
      } else {
        errors.push("Summary & Quality Gates: " + (summaryResult.reason?.message || "query failed"));
      }

      if (paretoResult.status === "fulfilled" && paretoResult.value) {
        const res = paretoResult.value;
        if (Array.isArray(res.pareto)) setPareto(res.pareto);
        if (Array.isArray(res.categoryPareto)) setCategoryParetoData(res.categoryPareto);
        if (Array.isArray(res.zonePareto)) setZoneParetoData(res.zonePareto);
        if (res.qualityGateDrillDown) setQualityGateDrillDown(res.qualityGateDrillDown);
      } else {
        errors.push("Pareto & Defect Drilldown: " + (paretoResult.reason?.message || "query failed"));
      }

      if (shiftResult.status === "fulfilled" && shiftResult.value) {
        const res = shiftResult.value;
        if (Array.isArray(res.shiftScrap)) setShiftScrap(res.shiftScrap);
      } else {
        errors.push("Shift Scrap: " + (shiftResult.reason?.message || "query failed"));
      }

      if (errors.length >= 3) {
        console.warn("[REJECTION UI] All modular endpoints failed; trying fallback rejectionAnalysis...");
        try {
          const fallbackRes = await dashboardApi.rejectionAnalysis(query, { timeout: 30000, suppressGlobalError: true });
          if (fallbackRes) {
            if (fallbackRes.summary) setSummary(fallbackRes.summary);
            if (Array.isArray(fallbackRes.qualityGates)) setQualityGates(fallbackRes.qualityGates);
            if (Array.isArray(fallbackRes.dieStats)) setDieStats(fallbackRes.dieStats);
            if (fallbackRes.qualityGateDrillDown) setQualityGateDrillDown(fallbackRes.qualityGateDrillDown);
            if (fallbackRes.mlInsights) setMlInsights(fallbackRes.mlInsights);
            if (Array.isArray(fallbackRes.pareto)) setPareto(fallbackRes.pareto);
            if (Array.isArray(fallbackRes.categoryPareto)) setCategoryParetoData(fallbackRes.categoryPareto);
            if (Array.isArray(fallbackRes.zonePareto)) setZoneParetoData(fallbackRes.zonePareto);
            if (Array.isArray(fallbackRes.shiftScrap)) setShiftScrap(fallbackRes.shiftScrap);
            if (fallbackRes.filterOptions) setFilterOptions(fallbackRes.filterOptions);
            errors.length = 0;
          }
        } catch (fallbackErr) {
          console.error("[REJECTION UI] Fallback rejectionAnalysis also failed:", fallbackErr.message);
        }
      }

      if (errors.length > 0) setDataErrors(errors);
      setLastUpdated(new Date());
      setLoading(false); // the page renders here; details keep loading below

      // 2. NG part records, after the page has rendered
      setDetailsLoading(true);
      const [ngResult] = await Promise.allSettled([
        dashboardApi.rejectionRows({ ...query, status: "NG", page: 1, pageSize: 10000 }, { timeout: 90000, suppressGlobalError: true }),
      ]);
      if (!isCurrent()) return;
      const detailErrors = [];
      if (ngResult.status === "fulfilled" && Array.isArray(ngResult.value?.rows)) {
        setNgRecords(ngResult.value.rows);
      } else {
        setNgRecords([]);
        detailErrors.push("NG records: " + (ngResult.reason?.message || "query failed"));
      }
      if (detailErrors.length) setDataErrors((prev) => [...prev, ...detailErrors]);
    } catch (err) {
      console.error("[REJECTION UI] Failed to load rejection analysis:", err);
      if (isCurrent()) setDataErrors([err.message || "Failed to load rejection data"]);
    } finally {
      if (isCurrent()) { setLoading(false); setDetailsLoading(false); }
    }
  }, [buildQuery]);

  useEffect(() => {
    setRecordsPage(1);
    loadData();
  }, [loadData]);

  /* ── 3. Process data + ML insights: loaded only for the tabs that use them ─ */
  const mlLoadedForRef = useRef(null);
  const [mlLoading, setMlLoading] = useState(false);
  const loadMlInsights = useCallback(async () => {
    const query = buildQuery();
    const key = JSON.stringify({ ...query, _ts: 0 });
    if (mlLoadedForRef.current === key) return;
    mlLoadedForRef.current = key;
    setMlLoading(true);
    try {
      const res = await dashboardApi.rejectionMlInsights(query, { timeout: 90000, suppressGlobalError: true });
      if (mlLoadedForRef.current !== key) return;
      if (res?.mlInsights) setMlInsights(res.mlInsights);
      if (Array.isArray(res?.telemetryRows) && res.telemetryRows.length > 0) setRows(res.telemetryRows);
      else if (Array.isArray(res?.rows)) setRows(res.rows);
    } catch (err) {
      if (mlLoadedForRef.current === key) {
        mlLoadedForRef.current = null; // retry on the next visit to an ML tab
        setDataErrors((prev) => [...prev, "Process ML Insights: " + (err.message || "query failed")]);
      }
    } finally {
      setMlLoading(false);
    }
  }, [buildQuery]);
  // new filters → previously loaded process data is stale; it reloads when an ML tab is shown
  useEffect(() => {
    mlLoadedForRef.current = null;
    setRows([]);
    setMlInsights({ features: [], topAnomalies: [] });
  }, [buildQuery]);
  useEffect(() => {
    if (activeTab === "ml_analysis" || activeTab === "telemetry") loadMlInsights();
  }, [activeTab, loadMlInsights]);

  /* ── Load Paginated Records ───────────────────────────────────────────── */
  const loadRejectionRows = useCallback(async (page = recordsPage, pageSize = recordsPageSize, search = "") => {
    setRecordsLoading(true);
    try {
      const query = { page, pageSize, status: "NG", noCache: "1", _ts: Date.now() };
      if (search && search.trim()) query.search = search.trim();
      if (filters.datePreset) query.datePreset = filters.datePreset;
      if (filters.datePreset === "all") query.allTime = "1";
      if (filters.dateFrom) query.dateFrom = filters.dateFrom;
      if (filters.dateTo) query.dateTo = filters.dateTo;
      if (filters.shiftCode) query.shiftCode = filters.shiftCode;
      if (filters.machineName) query.machineName = filters.machineName;
      if (filters.qualityGate) query.qualityGate = filters.qualityGate;
      if (filters.partName) query.partName = filters.partName;
      if (filters.partCategory) query.partCategory = filters.partCategory;
      if (filters.dieName) query.dieName = filters.dieName;

      const res = await dashboardApi.rejectionRows(query, { timeout: 30000, suppressGlobalError: true });
      if (res) {
        if (Array.isArray(res.rows)) setRecordsRows(res.rows);
        if (typeof res.total === "number") setRecordsTotal(res.total);
        else if (typeof res.count === "number") setRecordsTotal(res.count);
      }
    } catch (err) {
      console.warn("[REJECTION UI] rejectionRows query fallback:", err.message);
    } finally {
      setRecordsLoading(false);
    }
  }, [filters, recordsPage, recordsPageSize]);

  /* ── Preset Date Handlers ─────────────────────────────────────────────── */


  const handlePreset = (presetKey) => {
    const now = productionToday();
    let from = null;
    let to = null;

    if (presetKey === "today") {
      from = getLocalISODate(now);
      to = getLocalISODate(now);
    } else if (presetKey === "yesterday") {
      const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      from = getLocalISODate(yest);
      to = getLocalISODate(yest);
    } else if (presetKey === "last7") {
      from = getLocalISODate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      to = getLocalISODate(now);
    } else if (presetKey === "last30") {
      from = getLocalISODate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
      to = getLocalISODate(now);
    } else if (presetKey === "last90") {
      from = getLocalISODate(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));
      to = getLocalISODate(now);
    }

    setFilters((prev) => ({
      ...prev,
      datePreset: presetKey,
      dateFrom: from ? from : prev.dateFrom,
      dateTo: to ? to : prev.dateTo,
    }));
  };

  const handleDateApply = (from, to) => {
    setFilters((prev) => ({ ...prev, datePreset: "custom", dateFrom: from, dateTo: to }));
    setShowDatePicker(false);
  };

  const handleDateClear = () => {
    const now = productionToday();
    const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setFilters((prev) => ({
      ...prev,
      datePreset: "last30",
      dateFrom: getLocalISODate(past30),
      dateTo: getLocalISODate(now),
    }));
  };

  const handleClearAllFilters = () => {
    const now = new Date();
    const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setFilters({
      dateFrom: getLocalISODate(past30),
      dateTo: getLocalISODate(now),
      datePreset: "last30",
      shiftCode: "",
      machineName: "",
      qualityGate: "",
      partName: "",
      partCategory: "",
      dieName: "",
      status: "ALL",
    });
  };

  /* ── Rejected rows ────────────────────────────────────────────────────── */
  const rejectedRows = useMemo(
    () =>
      rows.filter((row) => {
        const values = [
          row.status, row.overall_status,
          row.op100_status, row.op110_status, row.op120_status, row.op130_status,
          row.op140_status, row.op150_status, row.op160_status,
        ].map((v) => String(v || "").trim().toUpperCase());
        return (
          values.some((v) => ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(v)) ||
          !!row.isDefective ||
          !!row.rejection_reason ||
          !!row.ng_reason ||
          !!row.rejectionReason ||
          !!row.ngReason
        );
      }),
    [rows]
  );

  /* Unified full rejection records pool */
  const allRejectionRecords = useMemo(() => {
    const map = new Map();
    const add = (r) => {
      if (!r) return;
      const key = r.id || r.partId || r.part_id || r.rowKey;
      if (!key) return;
      if (!map.has(key)) map.set(key, r);
      else {
        // first source wins; later sources only fill fields that are still empty
        const cur = map.get(key);
        const next = { ...cur };
        Object.entries(r).forEach(([k, v]) => { if ((next[k] === undefined || next[k] === null || next[k] === "") && v !== undefined) next[k] = v; });
        map.set(key, next);
      }
    };
    (ngRecords || []).forEach(add);
    (recordsRows || []).forEach(add);
    (rejectedRows || []).forEach(add);
    (rows || []).forEach((r) => {
      const isNg = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(String(r.status || r.overall_status || "").trim().toUpperCase())
        || !!r.isDefective || !!r.rejection_reason || !!r.ng_reason || !!r.rejectionReason || !!r.ngReason;
      if (isNg) add(r);
    });
    return Array.from(map.values());
  }, [ngRecords, recordsRows, rejectedRows, rows]);

  /* Enriched Die Stats */
  const enrichedDieStats = useMemo(() => {
    if (!Array.isArray(dieStats) || dieStats.length === 0) return [];
    const mapped = dieStats
      .map((d) => {
        const rawName = String(d.die_name || d.dieName || d.die || "").trim();
        const ok = Number(d.ok_count ?? d.totalOK ?? d.ok ?? 0);
        const ng = Number(d.ng_count ?? d.totalNG ?? d.ng ?? 0);
        const total = Number(d.total_shots ?? d.totalParts ?? d.total ?? (ok + ng));
        const inspected = ok + ng;
        const scrapRate = d.scrapRate != null && !isNaN(Number(d.scrapRate))
          ? Number(Number(d.scrapRate).toFixed(2))
          : inspected > 0 ? Number(((ng / inspected) * 100).toFixed(2)) : 0;
        const yieldRate = Number((100 - scrapRate).toFixed(2));
        return {
          die_name: rawName && rawName.toUpperCase() !== "UNKNOWN" && rawName !== "-" ? rawName : "Unknown Die",
          total_shots: total,
          ok_count: ok,
          ng_count: ng,
          inspected,
          scrapRate,
          yieldRate,
        };
      })
      .sort((a, b) => b.total_shots - a.total_shots);
    const namedOnly = mapped.filter((d) => d.die_name && d.die_name !== "Unknown Die");
    return namedOnly.length > 0 ? namedOnly : mapped;
  }, [dieStats]);

  /* Processed Quality Gates */
  const processedQualityGates = useMemo(() => {
    if (!qualityGates.length) return [];
    if (!isOp150Grouped) {
      return qualityGates.map((g) => {
        let shortLabel = g.shortLabel || g.code;
        if (g.code === "Leak-Test-01") shortLabel = "Leak-Test-1";
        else if (g.code === "Leak-Test-02") shortLabel = "Leak-Test-2";
        else if (g.code === "Leak Test-03" || g.code === "Leak-Test-03") shortLabel = "Leak-Test-3";
        return { ...g, shortLabel, displayName: stationLabels[g.code] || g.displayName || g.name || g.code };
      });
    }

    const isLeakStationCode = (c) => {
      const u = String(c || "").toUpperCase();
      return u === "OP150" || u.startsWith("LEAK");
    };

    const regularGates = [];
    const leakGates = [];

    qualityGates.forEach((g) => {
      if (isLeakStationCode(g.code)) leakGates.push(g);
      else regularGates.push({ ...g, shortLabel: g.shortLabel || g.code, displayName: stationLabels[g.code] || g.displayName || g.name || g.code });
    });

    if (leakGates.length === 0) return regularGates;

    const totalOk = leakGates.reduce((sum, g) => sum + (g.okCount || 0), 0);
    const totalNg = leakGates.reduce((sum, g) => sum + (g.ngCount || 0), 0);
    const totalInspected = totalOk + totalNg;
    const combinedScrapRate = totalInspected > 0 ? Number(((totalNg / totalInspected) * 100).toFixed(2)) : 0;

    const op150Combined = {
      code: "OP150", shortLabel: "OP150",
      name: "Leak Test OP150 (Total)", displayName: "Leak Test OP150 (Total)",
      okCount: totalOk, ngCount: totalNg, inspected: totalInspected, scrapRate: combinedScrapRate,
      subStations: leakGates, isGrouped: true,
    };

    const op140Idx = regularGates.findIndex((g) => g.code === "OP140");
    if (op140Idx !== -1) regularGates.splice(op140Idx + 1, 0, op150Combined);
    else regularGates.push(op150Combined);

    return regularGates;
  }, [qualityGates, isOp150Grouped, stationLabels]);

  /* ── Global Export Excel ──────────────────────────────────────────────── */
  const handleExportExcel = async () => {
    setExportState("loading");
    setExportMessage("Preparing export…");

    try {
      let exportSource = recordsRows.length > 0 ? recordsRows : rejectedRows;
      if (recordsTotal > exportSource.length) {
        try {
          const fullRes = await dashboardApi.rejectionRows({
            status: "NG",
            allTime: filters.datePreset === "all" ? "1" : undefined,
            datePreset: filters.datePreset,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            shiftCode: filters.shiftCode,
            machineName: filters.machineName,
            qualityGate: filters.qualityGate,
            partName: filters.partName,
            partCategory: filters.partCategory,
            dieName: filters.dieName,
            page: "1",
            pageSize: "10000",
          });
          if (fullRes?.rows?.length) exportSource = fullRes.rows;
        } catch (err) {
          console.warn("[REJECTION UI] Full export query fallback:", err);
        }
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "HPDC Quality Intelligence";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Rejection Records", { views: [{ state: "frozen", ySplit: 1 }] });

      sheet.columns = [
        { header: "Shot #", key: "shotNumber", width: 12 },
        { header: "Shot Date Time", key: "shotDateTime", width: 22 },
        { header: "Part ID (DMC/Barcode)", key: "partId", width: 26 },
        { header: "Customer QR Code", key: "customerQrCode", width: 32 },
        { header: "Status", key: "status", width: 10 },
        { header: "NG Gate", key: "ngGate", width: 14 },
        { header: "NG Recorded At", key: "ngRecordedAt", width: 22 },
        { header: "OP100", key: "op100", width: 10 },
        { header: "OP110", key: "op110", width: 10 },
        { header: "OP120", key: "op120", width: 10 },
        { header: "OP130", key: "op130", width: 10 },
        { header: "OP140", key: "op140", width: 10 },
        { header: "OP150", key: "op150", width: 10 },
        { header: "OP160", key: "op160", width: 10 },
        { header: "Zone", key: "zone", width: 16 },
        { header: "Sub-Zone", key: "subZone", width: 16 },
        { header: "Reason", key: "reason", width: 30 },
        { header: "Category", key: "category", width: 14 },
        { header: "Shift", key: "shiftCode", width: 10 },
        { header: "Machine", key: "machineName", width: 16 },
        { header: "Die", key: "dieName", width: 14 },
        { header: "Metal Pressure (bar)", key: "metalPressure", width: 20 },
        { header: "Furnace Temp (°C)", key: "metalTemp", width: 18 },
        { header: "Biscuit (mm)", key: "biscuitThickness", width: 14 },
        { header: "V1 Speed (m/s)", key: "v1Speed", width: 14 },
        { header: "V2 Speed (m/s)", key: "v2Speed", width: 14 },
        { header: "V3 Speed (m/s)", key: "v3Speed", width: 14 },
        { header: "Timestamp", key: "createdAt", width: 22 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.height = 22;
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3263" } };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };

      exportSource.forEach((r, idx) => {
        const rawPartId = String(r.partId || r.part_id || r.barcode || "").trim();
        const rawCustomerQr = String(r.customerQrCode || r.customerCode || r.customer_qr || "").trim();
        const isQrInPartId = looksLikeCustomerQr(rawPartId) || rawPartId === rawCustomerQr;
        const displayPartId = !isQrInPartId && rawPartId !== "-" ? rawPartId : "—";
        const displayCustomerQr = rawCustomerQr !== "-" && rawCustomerQr ? rawCustomerQr : isQrInPartId ? rawPartId : "—";
        const isCasted = Boolean(displayPartId && displayPartId !== "—" && !looksLikeCustomerQr(displayPartId));
        const shotNum = isCasted ? r.shotNumber || r.shot_number || extractShotFromPartId(displayPartId) || "—" : "—";
        const decodedShotDate = isCasted ? extractShotDateTimeFromPartId(displayPartId) : null;
        const rawShotDate = decodedShotDate || r.shot_datetime || r.shot_time || r.first_scan_at || (isCasted ? r.createdAt : null);
        const shotDateTime = isCasted && rawShotDate && rawShotDate !== "-" ? formatResultTimestamp(rawShotDate) : "—";

        let z = r.rejectionZone || r.rejection_zone || r.zone || "-";
        if (String(z).toLowerCase().includes("leak") || String(z).toLowerCase().includes("150")) z = "Leak Test";

        const row = sheet.addRow({
          shotNumber: shotNum,
          shotDateTime,
          partId: displayPartId,
          customerQrCode: displayCustomerQr,
          status: r.status || r.overall_status || "-",
          ngGate: r.ngGate || "-",
          ngRecordedAt: formatResultTimestamp(r.ngRecordedAt || r.final_scan_at),
          op100: r.op100_status || "-",
          op110: r.op110_status || "-",
          op120: r.op120_status || "-",
          op130: r.op130_status || "-",
          op140: r.op140_status || "-",
          op150: r.op150_status || "-",
          op160: r.op160_status || "-",
          zone: z,
          subZone: r.rejectionSubZone || r.rejection_sub_zone || "-",
          reason: r.reason || r.rejection_reason || r.ngReason || r.ng_reason || "-",
          category: r.category || r.rejection_category || "-",
          shiftCode: r.shiftCode || r.shift_code || "A",
          machineName: r.machineName || r.machine_name || "-",
          dieName: r.dieName || r.die_name || "-",
          metalPressure: r.metalPressure ?? r.metal_pressure ?? "-",
          metalTemp: r.metalTemp ?? r.furnace_metal_temp ?? "-",
          biscuitThickness: r.biscuitThickness ?? r.biscuit_thickness ?? "-",
          v1Speed: r.v1Speed ?? r.v1_speed ?? "-",
          v2Speed: r.v2Speed ?? r.v2_speed ?? "-",
          v3Speed: r.v3Speed ?? r.v3_speed ?? "-",
          createdAt: formatResultTimestamp(r.createdAt),
        });

        if (idx % 2 === 1) {
          row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), `Rejection_Analysis_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);

      setExportState("success");
      setExportMessage(`Exported ${exportSource.length.toLocaleString()} records`);
    } catch (err) {
      console.error("[REJECTION UI] Export failed:", err);
      setExportState("error");
      setExportMessage("Export failed. Please retry.");
    }
  };

  /* ── Derived: active filters count ────────────────────────────────────── */
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.shiftCode) n++;
    if (filters.machineName) n++;
    if (filters.qualityGate) n++;
    if (filters.partName) n++;
    if (filters.partCategory) n++;
    if (filters.dieName) n++;
    if (filters.status && filters.status !== "ALL") n++;
    return n;
  }, [filters]);

  /* ── Tab badges ───────────────────────────────────────────────────────── */
  const tabCounts = useMemo(() => ({
    overview: qualityGates.length,
    die_analysis: enrichedDieStats.length,
    ml_analysis: mlInsights.features?.length || 0,
    records: recordsTotal || summary.totalNG || recordsRows.length || rows.length,
  }), [qualityGates.length, enrichedDieStats.length, mlInsights.features, recordsTotal, summary.totalNG, recordsRows.length, rows.length]);

  // Button label: preset name + the exact production window it covers, in plant time
  const dateRangeLabel = useMemo(() => {
    const preset = DATE_PRESETS.find((p) => p.value === filters.datePreset);
    const title = preset && preset.value !== "custom" ? preset.label : "Custom range";
    const windowText = filters.datePreset === "all" ? "" : selectedDatesLabel(filters.dateFrom, filters.dateTo);
    return { title, windowText };
  }, [filters.dateFrom, filters.dateTo, filters.datePreset]);

  /* ═════════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════════ */
  return (
    <ChartDownloadProvider>
    <div className="rej-dashboard-root">
      {/* ══ HERO HEADER ══════════════════════════════════════════════════ */}
      <div className="rej-header-card">
        <div className="rej-header-gradient" />
        <div className="rej-header-flex">
          <div className="rej-header-titles">
            <div className="rej-header-icon">
              <AlertTriangle size={26} color="#ffffff" />
            </div>
            <div>
              <h1 className="rej-title-text">Rejection &amp; Quality Intelligence</h1>
              <div className="rej-subtitle-text">
                {/* scrap, OK and hotspot are in the KPI strip below (shown on every tab) */}
                {lastUpdated && (
                  <span className="rej-badge rej-badge-neutral" title={lastUpdated.toString()}>
                    <Clock size={12} /> Updated {relativeTime(lastUpdated)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="rej-header-actions">
            <button
              onClick={() => setShowSetParamsModal(true)}
              className="rej-action-btn rej-action-btn-success"
              title="View All 45 Master Recipe Set Parameters & Process Limits"
            >
              <Sliders size={15} />
              <span>Master Parameters</span>
              <span className="rej-action-count-badge">45</span>
            </button>

            <button onClick={loadData} disabled={loading} className="rej-action-btn" title="Refresh Live Data">
              <RefreshCw size={15} className={loading ? "rej-spin" : ""} />
              <span>{loading ? "Analyzing…" : "Refresh"}</span>
            </button>

            <button
              onClick={handleExportExcel}
              disabled={(!recordsRows.length && !rejectedRows.length) || exportState === "loading"}
              className={`rej-action-btn primary ${exportState === "success" ? "rej-action-btn-success" : ""}`}
              title="Export NG Records to Excel"
            >
              {exportState === "loading" ? (
                <><RefreshCw size={15} className="rej-spin" /><span>Exporting…</span></>
              ) : exportState === "success" ? (
                <><CheckCircle2 size={15} /><span>Exported</span></>
              ) : (
                <><FileSpreadsheet size={15} /><span>Export Excel</span></>
              )}
            </button>
          </div>
        </div>

        {loading && <div className="rej-header-progress" />}
      </div>

      {/* ══ ERROR BANNER ═════════════════════════════════════════════════ */}
      {dataErrors.length > 0 && (
        <div className="rej-error-banner" role="alert">
          <div className="rej-error-banner-content">
            <AlertTriangle size={16} />
            <div>
              <strong>Data Notice:</strong> {dataErrors.join(" • ")}.{" "}
              <button onClick={loadData} className="rej-error-banner-retry">Retry</button>
            </div>
          </div>
          <button
            onClick={() => setDataErrors([])}
            className="rej-error-banner-close"
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ══ FILTER DOCK ══════════════════════════════════════════════════ */}
      <div className="rej-filter-bar">
        <div className="rej-filter-left">
          <div className="rej-filter-group" ref={datePickerRef}>
            <button
              className="rej-filter-chip rej-filter-chip-primary"
              onClick={() => setShowDatePicker((s) => !s)}
              title="Filter date range"
            >
              <Calendar size={14} />
              <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2, textAlign: "left" }}>
                <span style={{ fontWeight: 700 }}>{dateRangeLabel.title}</span>
                {dateRangeLabel.windowText && (
                  <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.8, whiteSpace: "nowrap" }}>
                    {dateRangeLabel.windowText}
                  </span>
                )}
              </span>
              <ChevronDown size={13} />
            </button>

            {showDatePicker && (
              <div className="rej-date-picker-popover" style={{ padding: 10, width: "auto" }}>
                {/* quick ranges first, then the calendar for a specific day or range */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, maxWidth: 300 }}>
                  {DATE_PRESETS.filter((p) => p.value !== "custom").map((p) => {
                    const on = filters.datePreset === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => { handlePreset(p.value); setShowDatePicker(false); }}
                        style={{
                          padding: "5px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                          border: `1px solid ${on ? "#1e3a8a" : "#e2e8f0"}`, background: on ? "#1e3a8a" : "#fff", color: on ? "#fff" : "#334155",
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <DateRangePicker
                  key={`${filters.dateFrom || ""}|${filters.dateTo || ""}`}
                  startDate={filters.dateFrom}
                  endDate={filters.dateTo}
                  onApply={handleDateApply}
                  onClear={handleDateClear}
                />
              </div>
            )}
          </div>

          <select
            id="filter-partCategory"
            name="partCategory"
            value={filters.partCategory || ""}
            onChange={(e) => setFilters((p) => ({ ...p, partCategory: e.target.value }))}
            className="rej-select"
            aria-label="Filter by Part Category"
          >
            <option value="">All Part Types</option>
            <option value="HPDC">Casted Parts (HPDC)</option>
            <option value="OTHER">Other Parts</option>
          </select>

          {activeFilterCount > 0 && (
            <button className="rej-filter-chip rej-filter-chip-clear" onClick={handleClearAllFilters}>
              <X size={12} />
              <span>Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}</span>
            </button>
          )}
        </div>

        <div className="rej-filter-right">
          <button
            className="rej-icon-btn"
            onClick={loadData}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh data"
          >
            <RefreshCw size={14} className={loading ? "rej-spin" : ""} />
          </button>
        </div>
      </div>

      {(detailsLoading || mlLoading) && !loading && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", padding: "7px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#475569" }}>
          <RefreshCw size={13} className="rej-spin" /> {mlLoading ? "Loading process data for this tab…" : "Loading part records…"} charts fill in as they arrive.
        </div>
      )}

      {/* ══ KEY FIGURES — stay visible on every tab ══════════════════════ */}
      <RejectionKpiStrip summary={summary} qualityGates={qualityGates} />

      {/* ══ TAB NAVIGATION ═══════════════════════════════════════════════ */}
      <div className="rej-tabs-nav" role="tablist">
        {TAB_DEFS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          const count = tabCounts[tab.key];
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              className={`rej-tab-btn ${isActive ? "active" : ""}`}
              style={isActive ? { "--tab-accent": tab.color } : undefined}
            >
              <Icon size={16} color={isActive ? tab.color : "#64748b"} />
              <span>{tab.label}</span>
              {count != null && count > 0 && (
                <span
                  className="rej-tab-count"
                  style={isActive ? { background: `${tab.color}20`, color: tab.color } : undefined}
                >
                  {typeof count === "number" ? count.toLocaleString() : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══ TAB CONTENT ══════════════════════════════════════════════════ */}
      <div className="rej-tab-content-wrapper">
        {activeTab === "overview" && (
          <QualityGatesTab
            loading={loading}
            summary={summary}
            qualityGates={qualityGates}
            stationLabels={stationLabels}
            rejectionConfig={rejectionConfig}
            qualityGateDrillDown={qualityGateDrillDown}
            pareto={pareto}
            categoryParetoData={categoryParetoData}
            zoneParetoData={zoneParetoData}
            shiftScrap={shiftScrap}
            rows={rows}
            recordsRows={recordsRows}
            allRejectionRecords={allRejectionRecords}
            rejectedRows={rejectedRows}
            filters={filters}
          />
        )}

        {activeTab === "ml_analysis" && (
          <RootCauseTab
            mlInsights={mlInsights}
            summary={summary}
            pareto={pareto}
            rows={rows}
            recordsRows={recordsRows}
            allRejectionRecords={allRejectionRecords}
            rejectedRows={rejectedRows}
            filters={filters}
            loading={mlLoading}
          />
        )}

        {activeTab === "telemetry" && (
          <TelemetryTab
            rows={rows}
            recordsRows={recordsRows}
            allRejectionRecords={allRejectionRecords}
            mlInsights={mlInsights}
            onOpenRecipeModal={() => setShowSetParamsModal(true)}
            loading={mlLoading}
          />
        )}

        {activeTab === "records" && (
          <ScrapRecordsTab
            recordsRows={recordsRows.length ? recordsRows : ngRecords}
            recordsTotal={recordsTotal || ngRecords.length}
            recordsLoading={recordsLoading}
            loading={loading}
            summary={summary}
            rows={rows}
            rejectedRows={rejectedRows}
            loadRejectionRows={loadRejectionRows}
            filters={filters}
            stationLabels={stationLabels}
          />
        )}

        {activeTab === "die_analysis" && (
          <DieWiseTab
            dieStats={dieStats}
            filteredTableRows={allRejectionRecords}
            recordsRows={recordsRows}
            rows={rows}
            summary={summary}
          />
        )}



        {activeTab === "heat_map" && (
          <HeatMapTab
            allRejectionRecords={allRejectionRecords}
            rejectedRows={rejectedRows}
            rows={rows}
            recordsRows={recordsRows}
            rejectionConfig={rejectionConfig}
          />
        )}
      </div>

      {/* ══ MODAL ════════════════════════════════════════════════════════ */}
      <MasterRecipeModal
        isOpen={showSetParamsModal}
        onClose={() => setShowSetParamsModal(false)}
        mlInsights={mlInsights}
      />

      {/* ══ EXPORT TOAST ════════════════════════════════════════════════ */}
      {exportMessage && (
        <div className={`rej-srt-toast ${exportState}`}>
          {exportState === "success" && <CheckCircle2 size={14} />}
          {exportState === "error"   && <X size={14} />}
          {exportState === "loading" && <RefreshCw size={14} className="rej-spin" />}
          <span>{exportMessage}</span>
        </div>
      )}
    </div>
    </ChartDownloadProvider>
  );
}