import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { reportApi, machineApi, shiftApi } from '../../api/services';
import { toDatetimeLocal } from '../../utils/time';
import { loadReportConfig } from '../../utils/reportConfig';
import ReportSummaryCards from './ReportSummaryCards';
import ReportTable from './ReportTable';
import { FileText, Download, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLanguage } from '../../context/LanguageContext';

const DEFAULT_PLC_CYCLE_COLUMNS = [
  "machine_name","shot_date","shot_time","shot_number","cycle_time",
  "die_close_core_in_time","pouring_time","shot_fwd_time","curing_time","die_open_core_out_time",
  "ejector_time","extract_time","spray_time","v1_speed","v2_speed","v3_speed","v4_speed","metal_pressure",
  "furnace_metal_temp","cooling_water_mov","cooling_water_sta","accel_point","deaccel_point","intensification_time",
  "biscuit_thickness","jet_cooling_pressure","clamp_tonnage_he_low_pct","clamp_tonnage_he_low_mn","clamp_tonnage_op_up_pct",
  "clamp_tonnage_op_low_pct","clamp_tonnage_he_up_pct","vacuum_pressure","clamp_force_pct","clamp_tonnage","shot_acc_pressure",
  "intensification_acc_pressure","fixed_die_temp_f1","fixed_die_temp_f2","moving_die_temp_m1","moving_die_temp_m2","slide_temp_s1",
  "fix_1_flow","fix_2_flow","fix_3_flow","mov_1_flow","mov_2_flow","mov_3_flow","vacuum_pressure_mmhg",
  "average_die_clamp_tonnage_count","time_for_stroke","stroke","shot_status"
];
const LEAK_TEST_OPERATION = "OP150";
const LEAK_TEST_SHARED_KEY = "__LEAK_TEST_OP150__";
const LEAK_TEST_COLUMNS = [
  { key: "Body_Leak_Value", label: "Body Leak Value" },
  { key: "Gall_1", label: "Gall_1" },
  { key: "Gall_2", label: "Gall_2" },
  { key: "Cycle_Time", label: "Cycle Time" },
  { key: "Running_Mode", label: "Running Mode" },
  { key: "Manual", label: "Manual" },
  { key: "Dry", label: "Dry" },
  { key: "Wey", label: "Wey" },
  { key: "Both", label: "Both" },
];
const getLeakTestStatus = (reading) => {
  const result = String(reading?.Result || reading?.result || "").trim().toUpperCase();
  if (result === "OK") return "OK";
  if (result === "NG") return "NG";
  if (!reading) return "";
  return "IN_PROGRESS";
};
const getLeakTestValue = (reading, key) => {
  if (!reading) return "-";
  if (key === "Machine") {
    return reading.Machine || reading.machineName || reading.matchedMachineName || "-";
  }
  if (key === "Cycle_End_Time") {
    const raw = reading.Cycle_End_Time || reading.cycleEndTime || "";
    if (!raw) return "-";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? String(raw) : parsed.toLocaleString("en-IN");
  }
  return reading[key] ?? "-";
};

const normResult = (v, reason = "", row = null) => {
  const s = String(v || "").toUpperCase().trim();
  const r = String(reason || "").toUpperCase().trim();
  const bypassStatus = Boolean(row?.bypassStatus || row?.is_bypassed || row?.isBypassed);
  const bypassReason = String(row?.bypassReason || row?.bypass_reason || "").toUpperCase().trim();
  if (bypassStatus || ["MACHINE_BYPASS_AUTO_OK", "STATION_BYPASS_AUTO_OK", "STATION_OPERATION_DISABLED_AUTO_OK"].includes(bypassReason)) {
    return "OK";
  }
  if (r === "NG_SHOT_STATUS" && ["BLOCK", "INTERLOCKED"].includes(s)) return "NG";
  if (["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(s)) return "OK";
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG", "INTERLOCKED"].includes(s)) return "NG";
  if (!s || s === "-" || s === "UNKNOWN") return "";
  return "IN_PROGRESS";
};
const resultRank = (value) => {
  if (value === "NG") return 3;
  if (value === "OK") return 2;
  if (value === "IN_PROGRESS") return 1;
  return 0;
};
const pickPreferredResult = (current, candidate) => {
  const currentRank = resultRank(current);
  const candidateRank = resultRank(candidate);
  if (candidateRank > currentRank) return candidate;
  return current || candidate;
};
const operationResultRank = (value) => {
  if (value === "OK") return 3;
  if (value === "NG") return 2;
  if (value === "IN_PROGRESS") return 1;
  return 0;
};
const pickPreferredOperationResult = (current, candidate) => {
  const currentRank = operationResultRank(current);
  const candidateRank = operationResultRank(candidate);
  if (candidateRank > currentRank) return candidate;
  return current || candidate;
};
const formatPlcColumnLabel = (key) => {
  const raw = String(key || "").trim();
  if (!raw) return "PLC";
  const friendly = {
    machine_name: "Machine Name",
    part_name: "Part Name",
    shot_date: "Shot Date",
    shot_time: "Shot Time",
    shot_number: "Shot Number",
    shot_status: "Shot Status",
  };
  if (friendly[raw]) return friendly[raw];
  const formatted = raw
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? (w.charAt(0).toUpperCase() + w.slice(1)) : w))
    .join(" ");
  return formatted.replace(/^Plc\s+/i, "");
};
const extractShotFromPartId = (partId) => {
  const s = String(partId || "").trim();
  if (!s) return "";
  const machineCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machineCode>[A-Z0-9]{1})(?<shot>\d{1,6})$/i);
  if (machineCompact?.groups?.shot) return String(machineCompact.groups.shot).trim();
  const legacyCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<shot>\d{1,6})$/);
  if (legacyCompact?.groups?.shot) return String(legacyCompact.groups.shot).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length > 12) return digits.slice(12);
  return "";
};

const ReportsPage = () => {
  const { t } = useLanguage();
  const getMesDayRange = useCallback(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(6, 0, 0, 0);
    if (now < start) start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, []);

  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [machines, setMachines] = useState([]);
  const [availableShifts, setAvailableShifts] = useState([]);
  const [data, setData] = useState({ rows: [], metrics: {}, availableShifts: [] });
  const [reportConfig, setReportConfig] = useState(() => loadReportConfig());
  const fetchInFlightRef = useRef(false);
  const fetchQueuedRef = useRef(false);
  
  const [filters, setFilters] = useState(() => {
    const r = (() => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(6, 0, 0, 0);
      if (now < start) start.setDate(start.getDate() - 1);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    })();
    return {
      dateFrom: toDatetimeLocal(r.start),
      dateTo: toDatetimeLocal(r.end),
      machineId: '',
      lineName: '',
      shiftCode: '',
      status: '',
      station: '',
      barcode: '',
      customerCode: '',
      operatorId: '',
      resultType: '',
      modelCode: '',
      operationNo: ''
    };
  });
  const [quickRange, setQuickRange] = useState("today");

  const applyQuickRange = useCallback((key) => {
    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);
    if (key === "today") {
      const r = getMesDayRange();
      from.setTime(r.start.getTime());
      to.setTime(r.end.getTime());
    } else if (key === "yesterday") {
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    } else if (key === "last7") {
      from.setDate(from.getDate() - 7);
    } else if (key === "last15") {
      from.setDate(from.getDate() - 15);
    } else if (key === "last30") {
      from.setMonth(from.getMonth() - 1);
    }
    setFilters((prev) => ({
      ...prev,
      dateFrom: toDatetimeLocal(from),
      dateTo: toDatetimeLocal(to),
    }));
  }, [getMesDayRange]);

  const fetchData = useCallback(async () => {
    if (fetchInFlightRef.current) {
      fetchQueuedRef.current = true;
      return;
    }
    fetchInFlightRef.current = true;
    setLoading(true);
    try {
      const response = await reportApi.getData(filters);
      setData({ 
        rows: response.rows || [], 
        metrics: response.metrics || {},
        availableShifts: response.availableShifts || []
      });
    } catch (e) {
      console.error(e);
      toast.error(t("reports.failedLoad", "Failed to load production analytics"));
    } finally {
      setLoading(false);
      fetchInFlightRef.current = false;
      if (fetchQueuedRef.current) {
        fetchQueuedRef.current = false;
        fetchData();
      }
    }
  }, [filters]);

  useEffect(() => {
    machineApi.list().then(setMachines).catch(console.error);
    shiftApi.list().then(setAvailableShifts).catch(() => []);
    fetchData();
    try { setReportConfig(loadReportConfig()); } catch (err) { void err; }
  }, [fetchData]);

  const handleExport = async (type = "full") => {
    setExportLoading(true);
    const toastId = toast.loading(t("reports.preparingReport", "Preparing report..."));
    try {
      let blob;

      // Pass filters and reportConfig as separate args â€” services.js builds the body correctly
      if (type === 'full')  blob = await reportApi.exportFull(filters);
      else if (type === 'ng')    blob = await reportApi.exportNG(filters);
      else if (type === 'parts') blob = await reportApi.exportParts(filters);
      else if (type === 'audit') blob = await reportApi.exportAudit(filters);

      if (!blob) throw new Error("Empty response from export engine");

      const url  = window.URL.createObjectURL(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement('a');
      link.href  = url;
      const ts   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      link.setAttribute('download', `${type.toUpperCase()}_REPORT_${ts}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t("reports.reportDownloaded", "Report downloaded successfully"), { id: toastId });
    } catch (e) {
      console.error("Export failed:", e);
      toast.error(e?.response?.data?.error || t("reports.exportFailed", "Export failed — check console"), { id: toastId });
    } finally {
      setExportLoading(false);
    }
  };

  const reportTable = useMemo(() => {
    const sourceRows = data.rows || [];
    const plcByShot = new Map();
    sourceRows.forEach((r) => {
      const merged = {
        ...(r.plcReading || {}),
        ...(r.plc_reading || {}),
        ...(r.plcReadings || {}),
        ...(r.plcCycleReadings || {}),
        ...(r.plc_cycle_readings || {}),
        ...(r.leakTestReading || {}),
      };
      const shot = String(
        merged.shot_number || r.shot_number || r.shotNumber || extractShotFromPartId(r.partId || r.part_id || "")
      ).trim();
      if (shot && Object.keys(merged).length) plcByShot.set(shot, merged);
    });
    const machineStationPairs = (machines || [])
      .map((m) => {
        const machineName = String(m.machineName || m.machine_name || "").trim();
        const op = String(m.operationNo || m.operation_no || m.stationNo || m.station_no || "").trim();
        if (!machineName || !op) return null;
        if (String(op).trim().toUpperCase() === LEAK_TEST_OPERATION) {
          return { key: LEAK_TEST_SHARED_KEY, machineName: "Leak Test", op, label: "Leak Test OP150", sharedLeakOperation: true };
        }
        return { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
      })
      .filter(Boolean);
    const machineStationMap = new Map(machineStationPairs.map((x) => [x.key, x]));
    const rowStationPairs = sourceRows
      .map((r) => {
        const machineName = String(r.machineName || "").trim();
        const op = String(r.operationNo || r.stationNo || "").trim();
        if (!machineName || !op) return null;
        if (String(op).trim().toUpperCase() === LEAK_TEST_OPERATION) {
          return { key: LEAK_TEST_SHARED_KEY, machineName: "Leak Test", op, label: "Leak Test OP150", sharedLeakOperation: true };
        }
        return { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
      })
      .filter(Boolean);
    rowStationPairs.forEach((x) => {
      if (!machineStationMap.has(x.key)) machineStationMap.set(x.key, x);
    });
    const stationPairs = Array.from(machineStationMap.values()).sort((a, b) =>
      a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) || a.machineName.localeCompare(b.machineName)
    );
    const requiredOperations = Array.from(
      new Set(
        stationPairs
          .map((s) => String(s.op || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    const plcKeys = DEFAULT_PLC_CYCLE_COLUMNS.filter((key) => !["machine_name", "shot_number", "shot_date", "shot_time"].includes(key));
    const plcColumns = (() => {
      const used = new Map();
      const baseColumns = [{ key: "shot_datetime", label: "Shot Date & Time" }, ...plcKeys.map((key) => ({ key, label: formatPlcColumnLabel(key) }))];
      return baseColumns.map(({ key, label: initialLabel }) => {
        const base = initialLabel;
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        return { key, label: count === 0 ? base : `${base} (${count + 1})` };
      });
    })();
    const grouped = new Map();
    sourceRows.forEach((row, idx) => {
      const partKey = String(row.partId || row.part_id || row.barcode || row.shot_uid || `row_${idx}`).trim();
      const key = partKey || `row_${idx}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });

    const dynamicColumns = [
      { key: "srNo", label: "Sr No" },
      { key: "plc_shot_number", label: "Shot Number" },
      { key: "barcode", label: "Part Serial No." },
      { key: "customerCode", label: "Customer QR Code" },
      { key: "partName", label: "Part Name" },
      { key: "plc_machine_name", label: "Machine Name" },
      { key: "createdAt", label: "Scanned Date & Time" },
      ...stationPairs.map((s) => ({
        key: `station_${s.key}`,
        label: s.label,
        renderAsText: Boolean(s.sharedLeakOperation),
        renderLeakOperation: Boolean(s.sharedLeakOperation),
      })),
      { key: "overallStatus", label: "Final Status" },
      ...plcColumns.map((c) => ({ key: `plc_${c.key}`, label: c.label })),
      ...LEAK_TEST_COLUMNS.map((c) => ({ key: `leak_${c.key}`, label: c.label })),
      { key: "ngReason", label: "Reason / Remark" },
    ];

    const dynamicRows = Array.from(grouped.values()).map((entries, idx) => {
      const first = entries[0] || {};
      const partKey = String(first.partId || first.part_id || first.barcode || first.shot_uid || `row_${idx}`).trim();
      const stationResults = {};
      const stationDisplayValues = {};
      const operationResults = {};
      const stationCycleTimes = {};
      const plcData = {};
      let leakData = null;
      const firstScanAt = entries.reduce((earliest, row) => {
        const raw = row.firstScanCreatedAt || row.createdAtRaw || row.createdAt || null;
        if (!raw) return earliest;
        if (!earliest) return raw;
        return new Date(raw).getTime() < new Date(earliest).getTime() ? raw : earliest;
      }, null);
      entries.forEach((row) => {
        const stationOp = String(row.operationNo || row.stationNo || "").trim();
        const stationMachine = String(row.machineName || "").trim();
        const stationKey = stationMachine && stationOp ? `${stationMachine}__${stationOp}` : "";
        const rowLeakData = row.leakTestReading && typeof row.leakTestReading === "object" ? row.leakTestReading : null;
        if (!leakData && rowLeakData) {
          leakData = rowLeakData;
        }
        if (stationKey) {
          const normalizedStationResult = normResult(
            stationOp === LEAK_TEST_OPERATION
              ? ""
              : String(row.industrialResult || row.statusLabel || row.result || "-").toUpperCase(),
            row.reason || row.interlock_reason,
            row
          );
          if (normalizedStationResult) {
            stationResults[stationKey] = pickPreferredResult(stationResults[stationKey], normalizedStationResult);
          }
          if (stationOp && normalizedStationResult) {
            operationResults[stationOp] = pickPreferredOperationResult(operationResults[stationOp], normalizedStationResult);
          }
          stationCycleTimes[stationKey] = row.cycleTime || "-";
        }
        const nextPlcData = {
          ...(row.plcReading || {}),
          ...(row.plc_reading || {}),
          ...(row.plcReadings || {}),
          ...(row.plcCycleReadings || {}),
          ...(row.plc_cycle_readings || {}),
        };
        Object.keys(nextPlcData).forEach((key) => {
          if (plcData[key] === undefined || plcData[key] === null || plcData[key] === "" || plcData[key] === "-") {
            plcData[key] = nextPlcData[key];
          }
        });
      });
      if (leakData) {
        const leakStatus = getLeakTestStatus(leakData);
        const leakMachineName = String(leakData.matchedMachineName || leakData.Machine || leakData.machineName || "").trim();
        stationResults[LEAK_TEST_SHARED_KEY] = pickPreferredResult(stationResults[LEAK_TEST_SHARED_KEY], leakStatus);
        stationDisplayValues[LEAK_TEST_SHARED_KEY] = leakMachineName
          ? `${leakMachineName} ${leakStatus || "-"}`.trim()
          : (leakStatus || "-");
        operationResults[LEAK_TEST_OPERATION] = pickPreferredOperationResult(operationResults[LEAK_TEST_OPERATION], leakStatus);
      }
      if (!Object.keys(plcData).length) {
        const shot = String(first.shot_number || first.shotNumber || extractShotFromPartId(partKey) || "").trim();
        if (shot && plcByShot.has(shot)) Object.assign(plcData, plcByShot.get(shot));
      }
      const shaped = {
        srNo: idx + 1,
        plc_shot_number: plcData.shot_number ?? first.shot_number ?? first.shotNumber ?? extractShotFromPartId(partKey) ?? "-",
        barcode: partKey || "â€”",
        plc_machine_name: plcData.machine_name || first.machineName || "-",
        createdAt: firstScanAt ? new Date(firstScanAt).toLocaleString("en-IN") : "-",
        partName: plcData.part_name || first.partName || first.modelName || first.componentName || "-",
        customerCode: first.customerQrCode || first.customer_qr || "-",
        overallStatus: (() => {
          const vals = requiredOperations.map((operation) => normResult(operationResults[operation])).filter(Boolean);
          if (vals.some((v) => v === "NG")) return "NG";
          if (requiredOperations.length > 0 && requiredOperations.every((operation) => normResult(operationResults[operation]) === "OK")) {
            return "PASSED";
          }
          if (vals.some((v) => v === "IN_PROGRESS") || vals.length < requiredOperations.length) return "IN_PROGRESS";
          return "IN_PROGRESS";
        })(),
        ngReason: (() => {
          const rawReason = first.reason || first.interlock_reason || "";
          const normalizedReason = String(rawReason || "").trim().toUpperCase();
          if (!rawReason || rawReason === "-" || normalizedReason === "RECOVERY_PENDING_AFTER_BACKEND_RESTART") {
            return "";
          }
          return rawReason;
        })(),
        cycleStartTime: firstScanAt ? new Date(firstScanAt).toLocaleString("en-IN") : "-",
        cycleTimeValue: stationPairs.length ? (stationCycleTimes[stationPairs[stationPairs.length - 1].key] || "-") : "-",
      };
      stationPairs.forEach((s) => {
        shaped[`station_${s.key}`] = s.sharedLeakOperation
          ? ({
              machineName: String(leakData?.matchedMachineName || leakData?.Machine || leakData?.machineName || "").trim(),
              status: String(getLeakTestStatus(leakData) || "").trim().toUpperCase() || "-",
              text: stationDisplayValues[s.key] || "-",
            })
          : (normResult(stationResults[s.key]) || "-");
        shaped[`cycle_${s.key}`] = stationCycleTimes[s.key] || "-";
      });
      plcColumns.forEach(({ key }) => {
        if (key === "shot_datetime") {
          const y = plcData.shot_year ?? first.shot_year;
          const m = plcData.shot_month ?? first.shot_month;
          const d = plcData.shot_day ?? first.shot_day;
          const hh = plcData.shot_hour ?? first.shot_hour;
          const mm = plcData.shot_minute ?? first.shot_minute;
          const ss = plcData.shot_second ?? first.shot_second;
          shaped[`plc_${key}`] = (y !== undefined && m !== undefined && d !== undefined && hh !== undefined && mm !== undefined && ss !== undefined)
            ? `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
            : `${plcData.shot_date ?? first.shot_date ?? "-"} ${plcData.shot_time ?? first.shot_time ?? ""}`.trim();
        } else if (key === "shot_status") {
          const code = Number(plcData[key] ?? first[key]);
          shaped[`plc_${key}`] = ({ 1: "OK", 3: "WARM UP SHOT", 5: "OFF SHOT" }[code] || (plcData[key] ?? first[key] ?? "-"));
        } else {
          shaped[`plc_${key}`] = plcData[key] ?? first[key] ?? "-";
        }
      });
      LEAK_TEST_COLUMNS.forEach(({ key }) => {
        shaped[`leak_${key}`] = getLeakTestValue(leakData, key);
      });
      return shaped;
    });

    return { columns: dynamicColumns, rows: dynamicRows };
  }, [data.rows, filters.machineId, machines]);

  const reportSummaryMetrics = useMemo(() => {
    const rows = Array.isArray(reportTable.rows) ? reportTable.rows : [];
    const sourceRows = Array.isArray(data.rows) ? data.rows : [];
    const validationRejectParts = new Set(
      sourceRows
        .filter((row) => String(row?.category || "").trim().toUpperCase() === "VALIDATION")
        .map((row) => String(row?.partId || row?.part_id || "").trim())
        .filter(Boolean)
    );
    const summary = rows.reduce((acc, row) => {
      const status = String(row?.overallStatus || "").trim().toUpperCase();
      acc.totalProduction += 1;
      if (status === "PASSED") acc.totalOK += 1;
      else if (status === "NG" || status === "FAILED") acc.totalNG += 1;
      else acc.inProgress += 1;
      return acc;
    }, {
      totalProduction: 0,
      totalOK: 0,
      totalNG: 0,
      inProgress: 0,
      validationRejects: validationRejectParts.size,
      passRate: 0,
    });
    const tested = summary.totalOK + summary.totalNG;
    summary.passRate = tested > 0 ? Number(((summary.totalOK / tested) * 100).toFixed(2)) : 0;
    return summary;
  }, [data.rows, reportTable.rows]);
  const availableLines = useMemo(
    () => [...new Set((machines || []).map((m) => String(m.line_name || m.lineName || "").trim()).filter(Boolean))],
    [machines]
  );

  return (
    <div className="space-y-4 pb-16 rise-in">
      {/* Page Header */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <FileText size={22} />
            </div>
            <div>
              <h1 className="db-header-title text-text-main">{t("reports.title", "Traceability Report")}</h1>
              <p className="db-header-subtitle">{t("reports.subtitle", "Production analytics and PLC cycle trace data")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-3 mb-2 flex items-center justify-between">
        <p className="text-[14px] font-bold text-text-muted uppercase tracking-wider">{t("reports.report", "Report")}</p>
        <div className="flex items-center gap-2">
          <button
            disabled={loading}
            onClick={fetchData}
            className="inline-flex items-center gap-2 bg-bg-dark text-text-main px-3 py-2 rounded-lg text-xs font-bold border border-border hover:border-primary/40 transition-all disabled:opacity-60"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> {loading ? t("reports.refreshing", "Refreshing...") : t("reports.refresh", "Refresh")}
          </button>
          <button
            disabled={exportLoading}
            onClick={() => handleExport("full")}
            className="inline-flex items-center gap-2 bg-primary text-on-primary px-4 py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-60"
          >
            <Download size={14} /> {exportLoading ? t("reports.downloading", "Downloading...") : t("reports.downloadReport", "Download Report")}
          </button>
        </div>
      </div>
      <div className="bg-bg-card border border-border rounded-xl p-4 shadow-sm grid gap-3 md:grid-cols-2 lg:grid-cols-5" style={{ boxShadow: "0 2px 12px rgba(26,50,99,.08),0 1px 3px rgba(26,50,99,.05)" }}>
        <select
          value={quickRange}
          onChange={(e) => {
            const key = e.target.value;
            setQuickRange(key);
            applyQuickRange(key);
          }}
          className="h-10 px-3 rounded-lg border border-border bg-bg-dark text-text-main text-xs min-w-0"
        >
          <option value="today">{t("reports.today", "Today")}</option>
          <option value="yesterday">{t("reports.yesterday", "Yesterday")}</option>
          <option value="last7">{t("reports.last7Days", "Last 7 Days")}</option>
          <option value="last15">{t("reports.last15Days", "Last 15 Days")}</option>
          <option value="last30">{t("reports.last1Month", "Last 1 Month")}</option>
        </select>
        <input
          type="datetime-local"
          value={filters.dateFrom || ""}
          onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
          className="h-10 px-3 rounded-lg border border-border bg-bg-dark text-text-main text-xs min-w-0"
        />
        <input
          type="datetime-local"
          value={filters.dateTo || ""}
          onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
          className="h-10 px-3 rounded-lg border border-border bg-bg-dark text-text-main text-xs min-w-0"
        />
        <select
          value={filters.lineName}
          onChange={(e) => setFilters((prev) => ({ ...prev, lineName: e.target.value, machineId: "" }))}
          className="h-10 px-3 rounded-lg border border-border bg-bg-dark text-text-main text-xs min-w-0"
        >
          <option value="">{t("reports.allLines", "All Lines")}</option>
          {availableLines.map((line) => <option key={line} value={line}>{line}</option>)}
        </select>
        <select
          value={filters.machineId}
          onChange={(e) => setFilters((prev) => ({ ...prev, machineId: e.target.value }))}
          className="h-10 px-3 rounded-lg border border-border bg-bg-dark text-text-main text-xs min-w-0"
        >
          <option value="">{t("reports.allMachines", "All Machines")}</option>
          {machines
            .filter((m) => !filters.lineName || String(m.line_name || m.lineName || "").trim() === filters.lineName)
            .map((m) => <option key={m.id} value={m.id}>{m.machine_name || m.machineName}</option>)}
        </select>
        <input
          value={filters.barcode || ""}
          onChange={(e) => setFilters((prev) => ({ ...prev, barcode: e.target.value }))}
          placeholder={t("reports.partId", "Part ID")}
          className="h-10 px-3 rounded-lg border border-border bg-bg-dark text-text-main text-xs min-w-0"
        />
        <select
          value={filters.status || ""}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
          className="h-10 px-3 rounded-lg border border-border bg-bg-dark text-text-main text-xs min-w-0"
        >
          <option value="">{t("reports.allStatus", "All Status")}</option>
          <option value="OK">{t("reports.passed", "PASSED")}</option>
          <option value="NG">{t("reports.failed", "FAILED")}</option>
        </select>
        <select
          value={filters.shiftCode || ""}
          onChange={(e) => setFilters((prev) => ({ ...prev, shiftCode: e.target.value }))}
          className="h-10 px-3 rounded-lg border border-border bg-bg-dark text-text-main text-xs min-w-0"
        >
          <option value="">{t("reports.allShifts", "All Shifts")}</option>
          {((data.availableShifts && data.availableShifts.length) ? data.availableShifts : availableShifts).map((shift) => (
            <option key={shift.shiftCode || shift.shift_code} value={shift.shiftCode || shift.shift_code}>
              {shift.shiftName || shift.shift_name || shift.shiftCode || shift.shift_code}
            </option>
          ))}
        </select>
        <button
          onClick={() => setFilters({
            dateFrom: toDatetimeLocal(getMesDayRange().start),
            dateTo: toDatetimeLocal(getMesDayRange().end),
            machineId: '', lineName: '', shiftCode: '', status: '', station: '', barcode: '', customerCode: '',
            operatorId: '', resultType: '', modelCode: '', operationNo: ''
          })}
          className="h-10 px-3 rounded-lg border border-red-400/30 bg-red-500/10 text-red-400 text-xs font-bold"
        >
          {t("reports.clear", "Clear")}
        </button>
        <button
          disabled={loading}
          onClick={fetchData}
          className="h-10 px-3 rounded-lg border text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ background: "rgba(84,119,146,0.10)", borderColor: "rgba(84,119,146,0.30)", color: "rgb(84,119,146)" }}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> {loading ? t("reports.loading", "Loading...") : t("reports.applyFilters", "Apply Filters")}
        </button>
      </div>

      <ReportSummaryCards metrics={reportSummaryMetrics} />

      <ReportTable rows={reportTable.rows} columns={reportTable.columns} loading={loading} />
    </div>
  );
};

export default ReportsPage;
