import { useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { dashboardApi } from "../../api/services";
import ScrapTable from "./mgmt/ScrapTable";
import {
  looksLikeCustomerQr,
  extractShotFromPartId,
  extractShotDateTimeFromPartId,
  formatResultTimestamp,
  ALL_45_PARAMETERS,
} from "./rejectionConstants";

// Parameter columns take their name and unit from the shared parameter catalog, so every tab agrees
const PARAM_BY_KEY = new Map(ALL_45_PARAMETERS.flatMap((p) => [[p.key, p], ...(p.altKeys || []).map((k) => [k, p])]));
const catalogLabel = (key, fallback) => { const p = PARAM_BY_KEY.get(key); return p ? `${p.label} (${p.unit})` : fallback; };


export default function ScrapRecordsTab({
  recordsRows = [],
  recordsTotal = 0,
  recordsLoading = false,
  loading = false,
  summary = {},
  rejectedRows = [],
  filters = {},
}) {
  const [tableSearch, setTableSearch] = useState("");

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


  return (
    <ScrapTable
      rows={recordsRows.length ? recordsRows : rejectedRows}
      total={recordsTotal || summary.totalNG || recordsRows.length}
      loading={recordsLoading || loading}
      onExport={handleExportExcel}
      onSearchChange={setTableSearch}
    />
  );
}
