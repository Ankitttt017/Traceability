import React, { useState, useMemo } from "react";
import { Search, Download } from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { dashboardApi } from "../../api/services";
import RejectionTable from "./RejectionTable";
import {
  looksLikeCustomerQr,
  fmtNum,
  extractShotFromPartId,
  extractShotDateTimeFromPartId,
  formatResultTimestamp,
  parseRowDefect,
  ALL_45_PARAMETERS,
} from "./rejectionConstants";

// Parameter columns take their name and unit from the shared parameter catalog, so every tab agrees
const PARAM_BY_KEY = new Map(ALL_45_PARAMETERS.flatMap((p) => [[p.key, p], ...(p.altKeys || []).map((k) => [k, p])]));
const catalogLabel = (key, fallback) => { const p = PARAM_BY_KEY.get(key); return p ? `${p.label} (${p.unit})` : fallback; };
import { OUTCOME, INK, STATUS, CARD_CSS, FONT_FAMILY, withAlpha, fmtInt } from "./chartTheme";

/*
 * The table body is rendered by the shared RejectionTable; its OK / NG / In-progress chips are re-coloured
 * here (scoped to .sr-root) so they use the module's outcome colours, normal weights and no pulsing dots.
 */
const SR_CSS = `
.sr-root{font-family:${FONT_FAMILY}}
.sr-root .sr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:14px 18px 12px;border-bottom:1px solid ${INK.border}}
.sr-root .sr-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sr-root .sr-select{padding:6px 10px;border-radius:8px;border:1px solid ${INK.axis};background:#fff;font-size:12px;font-weight:600;color:${INK.primary};cursor:pointer}
.sr-root .animate-pulse{animation:none !important}
.sr-root td span.rounded-full.border{font-weight:600 !important;box-shadow:none !important}
.sr-root td span.bg-emerald-50{background:${withAlpha(OUTCOME.ok, 0.1)} !important;color:#12805a !important;border-color:${withAlpha(OUTCOME.ok, 0.4)} !important}
.sr-root td span.bg-rose-50{background:${withAlpha(OUTCOME.ng, 0.1)} !important;color:${OUTCOME.ng} !important;border-color:${withAlpha(OUTCOME.ng, 0.4)} !important}
.sr-root td span.bg-amber-50{background:${withAlpha(STATUS.warning, 0.12)} !important;color:#8a5a00 !important;border-color:${withAlpha(STATUS.warning, 0.45)} !important}
.sr-root td span .bg-emerald-500{background:${OUTCOME.ok} !important}
.sr-root td span .bg-rose-500{background:${OUTCOME.ng} !important}
.sr-root td span .bg-amber-500{background:${STATUS.warning} !important}
.sr-root th{font-weight:600}
`;

export default function ScrapRecordsTab({
  recordsRows = [],
  recordsTotal = 0,
  recordsLoading = false,
  loading = false,
  summary = {},
  rows = [],
  rejectedRows = [],
  loadRejectionRows,
  filters = {},
  stationLabels = {},
}) {
  const [tableSearch, setTableSearch] = useState("");
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize, setRecordsPageSize] = useState(100);
  const [isCompactRecords, setIsCompactRecords] = useState(true);

  const handleExportExcel = async () => {
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
          category: filters.category,
          search: tableSearch || undefined,
          page: "1",
          pageSize: "10000",
        });
        if (fullRes && Array.isArray(fullRes.rows) && fullRes.rows.length > 0) {
          exportSource = fullRes.rows;
        }
      } catch (err) {
        console.warn("Full export fallback to current rows:", err);
      }
    }
    if (!exportSource.length) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("HPDC Scrap Traceability Log");

    sheet.columns = [
      { header: "Shot No.", key: "shotNumber", width: 14 },
      { header: "Cast Date & Time", key: "shotDateTime", width: 22 },
      { header: "Part Serial No.", key: "partId", width: 26 },
      { header: "Customer QR", key: "customerQrCode", width: 32 },
      { header: "Result", key: "status", width: 12 },
      { header: "Rejected At Station", key: "ngGate", width: 18 },
      { header: "Rejected At (Time)", key: "ngRecordedAt", width: 24 },
      { header: "OP100", key: "op100", width: 10 },
      { header: "OP110", key: "op110", width: 10 },
      { header: "OP120", key: "op120", width: 10 },
      { header: "OP130", key: "op130", width: 10 },
      { header: "OP140", key: "op140", width: 10 },
      { header: "OP150", key: "op150", width: 10 },
      { header: "OP160", key: "op160", width: 10 },
      { header: "Zone", key: "zone", width: 16 },
      { header: "Sub-Zone", key: "subZone", width: 16 },
      { header: "Defect Reason", key: "reason", width: 30 },
      { header: "Category", key: "category", width: 14 },
      { header: "Shift", key: "shiftCode", width: 10 },
      { header: "Machine", key: "machineName", width: 16 },
      { header: "Die", key: "dieName", width: 14 },
      { header: catalogLabel("metal_pressure", "Metal Pressure"), key: "metalPressure", width: 20 },
      { header: catalogLabel("furnace_metal_temp", "Furnace Temp (°C)"), key: "metalTemp", width: 18 },
      { header: catalogLabel("biscuit_thickness", "Biscuit (mm)"), key: "biscuitThickness", width: 14 },
      { header: "V1 Speed (m/s)", key: "v1Speed", width: 14 },
      { header: "V2 Speed (m/s)", key: "v2Speed", width: 14 },
      { header: "V3 Speed (m/s)", key: "v3Speed", width: 14 },
      { header: "Leak Body (mbar)", key: "leakBodyValue", width: 18 },
      { header: "Oil Gallery 1 Leak (mbar)", key: "leakGall1", width: 22 },
      { header: "Oil Gallery 2 Leak (mbar)", key: "leakGall2", width: 22 },
      { header: "Leak Test Cycle Time (s)", key: "leakCycleTime", width: 22 },
      { header: "Leak Test Mode", key: "leakRunningMode", width: 16 },
      { header: "Leak Test Dry / Wet", key: "leakDryWey", width: 18 },
      { header: "Record Created", key: "createdAt", width: 22 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A3263" },
    };

    exportSource.forEach((r) => {
      const rawPartId = String(r.partId || r.part_id || r.barcode || "").trim();
      const rawCustomerQr = String(r.customerQrCode || r.customerCode || r.customer_qr || "").trim();
      const isQrInPartId = looksLikeCustomerQr(rawPartId) || rawPartId === rawCustomerQr;
      const displayPartId = !isQrInPartId && rawPartId !== "-" ? rawPartId : "—";
      const displayCustomerQr = rawCustomerQr !== "-" && rawCustomerQr ? rawCustomerQr : (isQrInPartId ? rawPartId : "—");
      const isCasted = Boolean(displayPartId && displayPartId !== "—" && !looksLikeCustomerQr(displayPartId));
      const shotNum = isCasted ? (r.shotNumber || r.shot_number || extractShotFromPartId(displayPartId) || "—") : "—";
      const decodedShotDate = isCasted ? extractShotDateTimeFromPartId(displayPartId) : null;
      const rawShotDate = decodedShotDate || r.shot_datetime || r.shot_time || r.first_scan_at || (isCasted ? r.createdAt : null);
      const shotDateTime = (isCasted && rawShotDate && rawShotDate !== "-") ? formatResultTimestamp(rawShotDate) : "—";

      let z = r.rejectionZone || r.rejection_zone || r.zone || "-";
      if (String(z).toLowerCase().includes("leak") || String(z).toLowerCase().includes("150")) {
        z = "Leak Test";
      }

      sheet.addRow({
        shotNumber: shotNum,
        shotDateTime: shotDateTime,
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
        shiftCode: r.shiftCode || r.shift_code || "-",
        machineName: r.machineName || r.machine_name || "-",
        dieName: r.dieName || r.die_name || "-",
        metalPressure: r.metalPressure ?? r.metal_pressure ?? "-",
        metalTemp: r.metalTemp ?? r.furnace_metal_temp ?? "-",
        biscuitThickness: r.biscuitThickness ?? r.biscuit_thickness ?? "-",
        v1Speed: r.v1Speed ?? r.v1_speed ?? "-",
        v2Speed: r.v2Speed ?? r.v2_speed ?? "-",
        v3Speed: r.v3Speed ?? r.v3_speed ?? "-",
        leakBodyValue: r.leakBodyValue ?? r.leak_body_leak_value ?? "-",
        leakGall1: r.leakGall1 ?? r.leak_gall_1 ?? "-",
        leakGall2: r.leakGall2 ?? r.leak_gall_2 ?? "-",
        leakCycleTime: r.leakCycleTime ?? r.leak_cycle_time ?? "-",
        leakRunningMode: r.leakRunningMode || r.leak_running_mode || "-",
        leakDryWey: r.leakDryWey || r.leak_dry_wey_both || "-",
        createdAt: formatResultTimestamp(r.createdAt),
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Rejection_Analysis_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };


  const tableColumns = useMemo(() => [
    { key: "shot_number", label: "Shot no.", width: 90 },
    { key: "shot_datetime", label: "Cast date & time", width: 160, renderAsText: true },
    { key: "ng_timestamp", label: "Rejected at (time)", width: 165, renderAsText: true },
    { key: "barcode", label: "Part serial no.", width: 170 },
    { key: "customerCode", label: "Customer QR", width: 220 },
    { key: "station_op100", label: stationLabels["OP100"] || "DCM+DPM + OP100", width: 140 },
    { key: "station_op110", label: stationLabels["OP110"] || "Laser Marking + OP110", width: 140 },
    { key: "station_op120", label: stationLabels["OP120"] || "Casting PDi + OP120", width: 140 },
    { key: "station_op130", label: stationLabels["OP130"] || "Pre Inspection + OP130", width: 140 },
    { key: "station_op140", label: stationLabels["OP140"] || "Auto Guaging + OP140", width: 140 },
    { key: "station_op150", label: stationLabels["OP150"] || "Leak Test OP150", width: 140 },
    { key: "station_op160", label: stationLabels["OP160"] || "Final Inspection + OP160", width: 150 },
    { key: "overallStatus", label: "Result", width: 85 },
    { key: "rejection_category", label: "Category", width: 100 },
    { key: "ngReason", label: "Defect reason", width: 180 },
    { key: "rejection_view", label: "View", width: 100 },
    { key: "rejection_zone", label: "Zone", width: 100 },
    { key: "rejection_sub_zone", label: "Sub-zone", width: 100 },

    // Process parameters
    { key: "plc_cycle_time", label: "Cycle Time (s)", width: 110 },
    { key: "die_close_core_in_time", label: "Die close + core in (s)", width: 140 },
    { key: "pouring_time", label: "Pouring Time (s)", width: 110 },
    { key: "shot_fwd_time", label: "Shot forward time (s)", width: 120 },
    { key: "curing_time", label: "Curing Time (s)", width: 110 },
    { key: "die_open_core_out_time", label: "Die open + core out (s)", width: 140 },
    { key: "ejector_time", label: "Ejector Time (s)", width: 110 },
    { key: "extract_time", label: "Extract Time (s)", width: 110 },
    { key: "spray_time", label: "Spray Time (s)", width: 110 },
    { key: "v1_speed", label: "V1 Speed (m/s)", width: 110 },
    { key: "v2_speed", label: "V2 Speed (m/s)", width: 110 },
    { key: "v3_speed", label: "V3 Speed (m/s)", width: 110 },
    { key: "v4_speed", label: "V4 Speed (m/s)", width: 110 },
    { key: "metal_pressure", label: "Metal Pressure (bar)", width: 130 },
    { key: "furnace_metal_temp", label: "Furnace Metal Temp (°C)", width: 140 },
    { key: "cooling_water_mov", label: "Cooling water – moving die (°C)", width: 160 },
    { key: "cooling_water_sta", label: "Cooling water – fixed die (°C)", width: 160 },
    { key: "accel_point", label: "Acceleration point (mm)", width: 130 },
    { key: "deaccel_point", label: "Deceleration point (mm)", width: 130 },
    { key: "intensification_time", label: "Intensification Time (s)", width: 130 },
    { key: "biscuit_thickness", label: "Biscuit Thickness (mm)", width: 130 },
    { key: "jet_cooling_pressure", label: "Jet Cooling Pressure (bar)", width: 140 },
    { key: "clamp_tonnage_he_low_pct", label: "Clamp tonnage – HE lower (%)", width: 160 },
    { key: "clamp_tonnage_he_low_mn", label: "Clamp tonnage – HE lower (MN)", width: 160 },
    { key: "clamp_tonnage_op_up_pct", label: "Clamp tonnage – OP upper (%)", width: 160 },
    { key: "clamp_tonnage_op_low_pct", label: "Clamp tonnage – OP lower (%)", width: 160 },
    { key: "clamp_tonnage_he_up_pct", label: "Clamp tonnage – HE upper (%)", width: 160 },
    { key: "vacuum_pressure", label: "Vacuum pressure (mmHg)", width: 140 },
    { key: "clamp_force_pct", label: "Clamp force (%)", width: 120 },
    { key: "clamp_tonnage", label: "Clamp Tonnage (T)", width: 120 },
    { key: "shot_acc_pressure", label: "Shot accumulator pressure (bar)", width: 170 },
    { key: "intensification_acc_pressure", label: "Intensifier accumulator pressure (bar)", width: 190 },
    { key: "fixed_die_temp_f1", label: "Fixed Die Temp F1 (°C)", width: 140 },
    { key: "fixed_die_temp_f2", label: "Fixed Die Temp F2 (°C)", width: 140 },
    { key: "moving_die_temp_m1", label: "Moving Die Temp M1 (°C)", width: 140 },
    { key: "moving_die_temp_m2", label: "Moving Die Temp M2 (°C)", width: 140 },
    { key: "slide_temp_s1", label: "Slide Temp S1 (°C)", width: 130 },
    { key: "fix_1_flow", label: "Fixed die cooling 1 (L/min)", width: 150 },
    { key: "fix_2_flow", label: "Fixed die cooling 2 (L/min)", width: 150 },
    { key: "fix_3_flow", label: "Fixed die cooling 3 (L/min)", width: 150 },
    { key: "mov_1_flow", label: "Moving die cooling 1 (L/min)", width: 160 },
    { key: "mov_2_flow", label: "Moving die cooling 2 (L/min)", width: 160 },
    { key: "mov_3_flow", label: "Moving die cooling 3 (L/min)", width: 160 },
    { key: "vacuum_pressure_mmhg", label: "Vacuum pressure 2 (mmHg)", width: 150 },
    { key: "average_die_clamp_tonnage_count", label: "Avg. die clamp tonnage (count)", width: 170 },
    { key: "time_for_stroke", label: "Stroke time (s)", width: 120 },
    { key: "stroke", label: "Stroke (mm)", width: 110 },
    { key: "shot_status", label: "Shot result", width: 100 },

    // Leak test values
    { key: "leak_body_leak_value", label: "Body leak (mbar)", width: 130 },
    { key: "leak_gall_1", label: "Oil gallery 1 leak (mbar)", width: 160 },
    { key: "leak_gall_2", label: "Oil gallery 2 leak (mbar)", width: 160 },
    { key: "leak_cycle_time", label: "Leak test cycle time (s)", width: 150 },
    { key: "leak_running_mode", label: "Leak test mode", width: 120 },
    { key: "leak_dry_wey_both", label: "Leak test dry / wet", width: 130 },

    { key: "shift_code", label: "Shift", width: 70 },
    { key: "machine_name", label: "Machine", width: 110 },
    { key: "die_name", label: "Die", width: 100 },
  ].map((column) => ({ ...column, label: catalogLabel(column.key, column.label), blankIfEmpty: true })), [stationLabels]);


  const tableColumnsNgCompact = useMemo(() => {
    return tableColumns
      .filter((col) => !col.key.startsWith("station_op"))
      .reduce((acc, col) => {
        if (col.key === "overallStatus") {
          acc.push({ key: "ng_station", label: "Rejected at station", width: 160, blankIfEmpty: true });
        }
        acc.push(col);
        return acc;
      }, []);
  }, [tableColumns]);

  // Filtered rows for the table search with Customer QR isolation

  const filteredTableRows = useMemo(() => {
    const term = tableSearch.toLowerCase().trim();
    const sourceRows = recordsRows.length > 0 ? recordsRows : rejectedRows;
    const mapped = sourceRows.map((r, i) => {
      const rawPartId = String(r.partId || r.part_id || "").trim();
      const rawCustomerQr = String(r.customerQrCode || r.customer_qr || "").trim();
      const isQrInPartId = looksLikeCustomerQr(rawPartId) || rawPartId === rawCustomerQr;
      const displayPartId = !isQrInPartId && rawPartId !== "-" ? rawPartId : "";
      const displayCustomerQr = rawCustomerQr !== "-" ? rawCustomerQr : (isQrInPartId ? rawPartId : "");

      // Shot details and shot timestamp are strictly valid ONLY for genuine casted parts with Part ID
      const isCastedPart = Boolean(displayPartId && displayPartId !== "-" && !looksLikeCustomerQr(displayPartId));
      const rawShot = r.shot_number || r.shotNumber || "";
      const shotNum = isCastedPart ? (rawShot && rawShot !== "-" ? rawShot : extractShotFromPartId(displayPartId)) : "";
      const shotStat = isCastedPart && shotNum ? (r.shot_status || r.shotStatus || "") : "";
      const decodedShotDate = isCastedPart ? extractShotDateTimeFromPartId(displayPartId) : null;
      const rawShotDate = decodedShotDate || r.shot_datetime || r.shot_time || r.first_scan_at || (isCastedPart ? r.createdAt : null);
      const shotDateTime = (isCastedPart && rawShotDate && rawShotDate !== "-")
        ? formatResultTimestamp(rawShotDate)
        : "";

      let isLeakNg = r.isOp150Ng || r.isLeakNg || r.op150_status === 'NG' || r.op150_status === 'FAIL' || r.op150_status === 'FAILED';
      let parsedLeakData = null;
      if (r.leak_data) {
        try {
          parsedLeakData = typeof r.leak_data === 'string' ? JSON.parse(r.leak_data) : r.leak_data;
          const res = String(parsedLeakData?.result || parsedLeakData?.Raw_Result || parsedLeakData?.status || '').toUpperCase();
          if (res === 'NG' || res === 'FAIL' || res === 'FAILED') {
            isLeakNg = true;
          }
        } catch { /* unparsable leak_data — leave as recorded */ }
      }

      const rawNgStation = r.ngStation || r.ng_station || "";
      let ng_station = rawNgStation;
      if (!ng_station) {
        if (r.op100_status === 'NG' || r.op100_status === 'FAIL' || r.op100_status === 'FAILED') ng_station = "DCM+DPM (OP100)";
        else if (r.op110_status === 'NG' || r.op110_status === 'FAIL' || r.op110_status === 'FAILED') ng_station = "Laser Marking (OP110)";
        else if (r.op120_status === 'NG' || r.op120_status === 'FAIL' || r.op120_status === 'FAILED') ng_station = "Casting PDi (OP120)";
        else if (r.op130_status === 'NG' || r.op130_status === 'FAIL' || r.op130_status === 'FAILED') ng_station = "Pre Inspection (OP130)";
        else if (r.op140_status === 'NG' || r.op140_status === 'FAIL' || r.op140_status === 'FAILED') ng_station = "Auto Guaging (OP140)";
        else if (isLeakNg) ng_station = parsedLeakData?.matchedMachineName || parsedLeakData?.machineName
          ? `${parsedLeakData.matchedMachineName || parsedLeakData.machineName} (OP150)`
          : "Leak Test (OP150)";
        else if (r.op160_status === 'NG' || r.op160_status === 'FAIL' || r.op160_status === 'FAILED') ng_station = "Final Inspection (OP160)";
        else ng_station = r.machine_name || "";
      }

      let isAnyGateNg = ['NG', 'FAILED'].includes(String(r.status || r.overall_status || '').toUpperCase())
        || isLeakNg || Boolean(r.op100_status === 'NG' || r.op110_status === 'NG' || r.op120_status === 'NG' || r.op130_status === 'NG' || r.op140_status === 'NG' || r.op160_status === 'NG');

      // Category / defect / view / zone / sub-zone exactly as recorded at inspection (no invented defaults)
      const parsedDefect = parseRowDefect(r);
      const catParsed = parsedDefect.category || (isLeakNg ? "MR" : "");
      let reasonParsed = parsedDefect.reason && parsedDefect.reason !== "Defect" ? parsedDefect.reason : "";
      if (isLeakNg && (!reasonParsed || /op150|quality gate/i.test(reasonParsed))) {
        const bodyVal = r.leak_body_leak_value || parsedLeakData?.bodyLeakValue || parsedLeakData?.body_leak_value;
        reasonParsed = bodyVal ? `Body leak fail (${bodyVal} mbar)` : "Pressure leak fail (OP150)";
      }
      const viewParsed = parsedDefect.view || (isLeakNg ? "Leak test (sensor)" : "");
      const zoneParsed = parsedDefect.inferred ? "" : parsedDefect.zone;
      const subZoneParsed = parsedDefect.inferred ? "" : parsedDefect.subZone;

      let finalOverallStatus = isAnyGateNg ? "NG" : (r.status || r.overall_status || "");
      const rawNgTime = r.final_scan_at || r.finalScanAt || r.ngRecordedAt || r.updatedAt || r.createdAt;
      const ngTimestamp = rawNgTime ? formatResultTimestamp(rawNgTime) : "";

      return {
        id: r.id || `row-${i}`,
        shot_number: shotNum || "—",
        shot_status: shotStat || "—",
        shot_datetime: shotDateTime || "—",
        ng_timestamp: ngTimestamp || "—",
        barcode: displayPartId,
        customerCode: displayCustomerQr,
        ng_station,
        station_op100: r.op100_status && r.op100_status !== "-" ? r.op100_status : "",
        station_op110: r.op110_status && r.op110_status !== "-" ? r.op110_status : "",
        station_op120: r.op120_status && r.op120_status !== "-" ? r.op120_status : "",
        station_op130: r.op130_status && r.op130_status !== "-" ? r.op130_status : "",
        station_op140: r.op140_status && r.op140_status !== "-" ? r.op140_status : "",
        station_op150: isLeakNg ? "NG" : (r.op150_status && r.op150_status !== "-" ? r.op150_status : ""),
        station_op160: r.op160_status && r.op160_status !== "-" ? r.op160_status : "",
        overallStatus: finalOverallStatus,
        rejection_category: catParsed || "—",
        ngReason: reasonParsed || "—",
        rejection_view: viewParsed || "—",
        rejection_zone: zoneParsed || "—",
        rejection_sub_zone: subZoneParsed || "—",

        // Process parameters - preserve 0 values
        plc_cycle_time: fmtNum(r.cycleTime ?? r.plc_cycle_time),
        die_close_core_in_time: fmtNum(r.die_close_core_in_time),
        pouring_time: fmtNum(r.pouring_time),
        shot_fwd_time: fmtNum(r.shot_fwd_time),
        curing_time: fmtNum(r.curing_time),
        die_open_core_out_time: fmtNum(r.die_open_core_out_time),
        ejector_time: fmtNum(r.ejector_time),
        extract_time: fmtNum(r.extract_time),
        spray_time: fmtNum(r.spray_time),
        v1_speed: fmtNum(r.v1Speed ?? r.v1_speed),
        v2_speed: fmtNum(r.v2Speed ?? r.v2_speed),
        v3_speed: fmtNum(r.v3Speed ?? r.v3_speed),
        v4_speed: fmtNum(r.v4Speed ?? r.v4_speed),
        metal_pressure: fmtNum(r.metalPressure ?? r.metal_pressure),
        furnace_metal_temp: fmtNum(r.metalTemp ?? r.furnace_metal_temp),
        cooling_water_mov: fmtNum(r.cooling_water_mov),
        cooling_water_sta: fmtNum(r.cooling_water_sta),
        accel_point: fmtNum(r.accel_point),
        deaccel_point: fmtNum(r.deaccel_point),
        intensification_time: fmtNum(r.intensification_time),
        biscuit_thickness: fmtNum(r.biscuitThickness ?? r.biscuit_thickness),
        jet_cooling_pressure: fmtNum(r.jet_cooling_pressure),
        clamp_tonnage_he_low_pct: fmtNum(r.clamp_tonnage_he_low_pct),
        clamp_tonnage_he_low_mn: fmtNum(r.clamp_tonnage_he_low_mn),
        clamp_tonnage_op_up_pct: fmtNum(r.clamp_tonnage_op_up_pct),
        clamp_tonnage_op_low_pct: fmtNum(r.clamp_tonnage_op_low_pct),
        clamp_tonnage_he_up_pct: fmtNum(r.clamp_tonnage_he_up_pct),
        vacuum_pressure: fmtNum(r.vacuum_pressure),
        clamp_force_pct: fmtNum(r.clamp_force_pct),
        clamp_tonnage: fmtNum(r.clamp_tonnage),
        shot_acc_pressure: fmtNum(r.shot_acc_pressure),
        intensification_acc_pressure: fmtNum(r.intensification_acc_pressure),
        fixed_die_temp_f1: fmtNum(r.fixed_die_temp_f1),
        fixed_die_temp_f2: fmtNum(r.fixed_die_temp_f2),
        moving_die_temp_m1: fmtNum(r.moving_die_temp_m1),
        moving_die_temp_m2: fmtNum(r.moving_die_temp_m2),
        slide_temp_s1: fmtNum(r.slide_temp_s1),
        fix_1_flow: fmtNum(r.fix_1_flow),
        fix_2_flow: fmtNum(r.fix_2_flow),
        fix_3_flow: fmtNum(r.fix_3_flow),
        mov_1_flow: fmtNum(r.mov_1_flow),
        mov_2_flow: fmtNum(r.mov_2_flow),
        mov_3_flow: fmtNum(r.mov_3_flow),
        vacuum_pressure_mmhg: fmtNum(r.vacuum_pressure_mmhg),
        average_die_clamp_tonnage_count: fmtNum(r.average_die_clamp_tonnage_count),
        time_for_stroke: fmtNum(r.time_for_stroke),
        stroke: fmtNum(r.stroke),

        // Leak test values
        leak_body_leak_value: fmtNum(r.leakBodyValue ?? r.leak_body_leak_value ?? parsedLeakData?.body_leak_value ?? parsedLeakData?.bodyLeakValue),
        leak_gall_1: fmtNum(r.leakGall1 ?? r.leak_gall_1 ?? parsedLeakData?.gall_1_leak_value ?? parsedLeakData?.gall_1),
        leak_gall_2: fmtNum(r.leakGall2 ?? r.leak_gall_2 ?? parsedLeakData?.gall_2_leak_value ?? parsedLeakData?.gall_2),
        leak_cycle_time: fmtNum(r.leakCycleTime ?? r.leak_cycle_time ?? parsedLeakData?.cycle_time),
        leak_running_mode: r.leakRunningMode || r.leak_running_mode || parsedLeakData?.running_mode || "-",
        leak_dry_wey_both: r.leakDryWey || r.leak_dry_wey_both || parsedLeakData?.dry_wet_both || "-",

        shift_code: r.shiftCode || r.shift_code || "—",
        machine_name: r.machineName || r.machine_name || "-",
        die_name: r.dieName || r.die_name || "-",
      };
    });

    const cleaned = mapped.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === "-" ? null : value]),
    ));
    if (!term || recordsRows.length > 0) return cleaned;
    return cleaned.filter((r) =>
      String(r.barcode || "").toLowerCase().includes(term) ||
      String(r.customerCode || "").toLowerCase().includes(term) ||
      String(r.ngReason || "").toLowerCase().includes(term) ||
      String(r.machine_name || "").toLowerCase().includes(term) ||
      String(r.shot_number || "").toLowerCase().includes(term) ||
      String(r.rejection_zone || "").toLowerCase().includes(term) ||
      String(r.rejection_sub_zone || "").toLowerCase().includes(term) ||
      String(r.rejection_category || "").toLowerCase().includes(term) ||
      String(r.rejection_view || "").toLowerCase().includes(term)
    );
  }, [recordsRows, rejectedRows, tableSearch]);

  return (
        <div className="ra-card sr-root" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <style>{CARD_CSS + SR_CSS}</style>
          <div className="sr-head">
            <div style={{ minWidth: 0, flex: "1 1 260px" }}>
              <h3 className="ra-card-title">Scrap records</h3>
              <p className="ra-card-sub">
                Every rejected part with its station results, defect location and process readings
                {" · "}{fmtInt(recordsTotal || summary.totalNG || filteredTableRows.length)} records
              </p>
            </div>

            <div className="sr-tools">

              <div className="rej-search-box" style={{ minWidth: 260 }}>
                <Search size={15} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Search part serial, QR, reason, zone…"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                />
                {tableSearch && (
                  <button
                    onClick={() => setTableSearch("")}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Rows Per Page Shortcut */}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: INK.muted }}>
                <span>Rows per page</span>
                <select
                  className="sr-select"
                  value={recordsPageSize}
                  onChange={(e) => {
                    const sz = Number(e.target.value);
                    setRecordsPageSize(sz);
                    setRecordsPage(1);
                  }}
                >
                  {[50, 100, 250, 500, 1000, 2500, 5000].map((sz) => (
                    <option key={sz} value={sz}>{sz.toLocaleString()}</option>
                  ))}
                </select>
              </label>

              <button
                onClick={handleExportExcel}
                disabled={!(recordsRows.length || rejectedRows.length)}
                className="rej-action-btn primary"
                style={{ padding: "8px 16px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                title="Download every scrap record matching the filters as an Excel file"
              >
                <Download size={15} />
                <span>Export to Excel ({fmtInt(recordsTotal || summary.totalNG || filteredTableRows.length)})</span>
              </button>
            </div>
          </div>

          <div className="rej-table-wrapper" style={{ borderRadius: "0 0 14px 14px", overflow: "hidden" }}>
            <RejectionTable
              columns={tableColumnsNgCompact}
              rows={filteredTableRows}
              loading={recordsLoading || loading}
              pagination={{
                page: recordsPage,
                pageSize: recordsPageSize,
                total: recordsTotal || summary.totalNG || filteredTableRows.length,
              }}
              onPageChange={(p) => setRecordsPage(p)}
              onPageSizeChange={(sz) => {
                setRecordsPageSize(sz);
                setRecordsPage(1);
              }}
              defaultPageSize={100}
              pageSizeOptions={[50, 100, 250, 500, 1000, 2500, 5000]}
            />
          </div>
        </div>
  );
}
