/**
 * excelTemplateEngine.js
 * Industrial-grade Excel template engine using ExcelJS.
 * No external date dependencies — uses reportFormatter utilities.
 */

const ExcelJS = require("exceljs");
const { formatIndustrialTimestamp, resolveIndustrialResult } = require("./reportFormatter");
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

function stationResultRank(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "NG") return 3;
  if (normalized === "OK") return 2;
  return 0;
}

function pickPreferredStationResult(currentValue, nextValue) {
  return stationResultRank(nextValue) > stationResultRank(currentValue) ? nextValue : (currentValue || nextValue);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function generateIndustrialExcel(res, {
  rows = [],
  stationPairs = [],
  metrics = {},
  filters = {},
  reportConfig = {},
  sheetName = "Production Report",
  filePrefix = "PROD_REPORT"
}) {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  const NAVY = "FF1A3A7C";
  const RED = "FFC8191E";
  const TEAL = "FF0D9488";
  const GRAY = "FF4B5563";
  const WHITE = "FFFFFFFF";
  const LTGRAY = "FFF9FAFB";
  const BORDER = "FFD1D5DB";

  worksheet.getRow(1).height = 65;
  worksheet.mergeCells("A1:H1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = (reportConfig.headerLine1 || reportConfig.companyName || "Industrial Traceability System").toUpperCase();
  titleCell.font = { bold: true, size: 20, color: { argb: WHITE }, name: "Calibri" };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };

  if (reportConfig.logoUrl && reportConfig.showLogo) {
    try {
      let base64Data = reportConfig.logoUrl;
      if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
      if (base64Data && base64Data.length > 50) {
        const imageId = workbook.addImage({ base64: base64Data, extension: "png" });
        worksheet.addImage(imageId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 90, height: 55 } });
      }
    } catch (e) {
      console.warn("Logo addition failed:", e.message);
    }
  }

  worksheet.getRow(2).height = 32;
  worksheet.mergeCells("A2:H2");
  const subTitleCell = worksheet.getCell("A2");
  let subText = reportConfig.headerLine2 || "TRACEABILITY PRODUCTION REPORT";
  if (filters.machineId) subText += ` - MACHINE: ${filters.machineId}`;
  else if (filters.lineName) subText += ` - LINE: ${filters.lineName}`;
  subTitleCell.value = subText.toUpperCase();
  subTitleCell.font = { bold: true, size: 14, color: { argb: WHITE } };
  subTitleCell.alignment = { horizontal: "center", vertical: "middle" };
  subTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2D5BA3" } };

  worksheet.getColumn(1).width = 18;
  worksheet.getColumn(4).width = 18;

  const metaRows = [
    ["Report Type", sheetName, "Generated At", formatIndustrialTimestamp(new Date())],
    ["Line", filters.lineName || "All Lines", "Date From", formatIndustrialTimestamp(filters.dateFrom)],
    ["Machine", filters.machineId || "All Machines", "Date To", formatIndustrialTimestamp(filters.dateTo)],
    ["Shift", filters.shiftCode || "All Shifts", "Plant", reportConfig.plantName || "-"],
    ["Department", reportConfig.department || "-", "Prepared By", reportConfig.preparedBy || "-"],
  ];

  metaRows.forEach((r, i) => {
    const rowNum = i + 4;
    worksheet.getRow(rowNum).height = 20;
    const set = (col, val, bold) => {
      const c = worksheet.getCell(`${col}${rowNum}`);
      c.value = val;
      c.font = bold ? { bold: true, size: 10, color: { argb: NAVY } } : { size: 10 };
      c.alignment = { vertical: "middle" };
      c.border = {
        top: { style: "thin", color: { argb: BORDER } },
        bottom: { style: "thin", color: { argb: BORDER } },
        left: { style: "thin", color: { argb: BORDER } },
        right: { style: "thin", color: { argb: BORDER } },
      };
    };
    set("A", r[0], true); set("B", r[1], false); set("D", r[2], true); set("E", r[3], false);
    const emptyC = worksheet.getCell(`C${rowNum}`);
    emptyC.border = { top:{style:"thin",color:{argb:BORDER}}, bottom:{style:"thin",color:{argb:BORDER}}, left:{style:"thin",color:{argb:BORDER}}, right:{style:"thin",color:{argb:BORDER}} };
  });

  const summaryStart = 10;
  worksheet.mergeCells(`A${summaryStart}:K${summaryStart}`);
  const sumHeader = worksheet.getCell(`A${summaryStart}`);
  sumHeader.value = "PRODUCTION SUMMARY";
  sumHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  sumHeader.font = { bold: true, size: 10, color: { argb: NAVY } };
  sumHeader.alignment = { horizontal: "left", indent: 1 };
  sumHeader.border = { bottom: { style: "medium", color: { argb: NAVY } } };

  const summaryCards = [
    { label: "Total Production", value: metrics.totalProduction || 0, color: NAVY },
    { label: "Total OK", value: metrics.totalOK || 0, color: "FF059669" },
    { label: "Total NG", value: metrics.totalNG || 0, color: RED },
    { label: "Validation Rejects", value: metrics.validationRejects || 0, color: "FFD97706" },
    { label: "Pass Rate", value: `${metrics.passRate || 0}%`, color: TEAL },
  ];

  summaryCards.forEach((card, i) => {
    const col = i * 2 + 1;
    worksheet.getCell(summaryStart + 1, col).value = card.label;
    worksheet.getCell(summaryStart + 1, col).font = { bold: true, size: 8, color: { argb: GRAY } };
    worksheet.getCell(summaryStart + 1, col).alignment = { horizontal: "center" };
    worksheet.getCell(summaryStart + 2, col).value = card.value;
    worksheet.getCell(summaryStart + 2, col).font = { bold: true, size: 14, color: { argb: card.color } };
    worksheet.getCell(summaryStart + 2, col).alignment = { horizontal: "center" };
  });

  const stationMap = new Map();
  (stationPairs || []).forEach((s) => {
    if (!s?.key || !s?.label) return;
    stationMap.set(s.key, { key: s.key, machineName: s.machineName || "", op: s.op || "", label: s.label });
  });
  rows.forEach((row) => {
    const machineName = String(row.machineName || row.machine_name || row?.Machine?.machine_name || "").trim();
    const op = String(row.operation_no || row.operationNo || row.stationNo || "").trim();
    if (!machineName || !op) return;
    const key = `${machineName}__${op}`;
    if (!stationMap.has(key)) stationMap.set(key, { key, machineName, op, label: `${machineName} + ${op}` });
  });
  const stationPairsFinal = Array.from(stationMap.values()).sort((a, b) =>
    a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) || a.machineName.localeCompare(b.machineName)
  );

  const grouped = new Map();
  rows.forEach((row) => {
    const partSerial = row.part_id || row.partId || "-";
    if (!grouped.has(partSerial)) {
      grouped.set(partSerial, {
        partSerial,
        machineName: row.machineName || "-",
        createdAt: row.createdAt || row.created_at || "-",
        cycleStart: row.cycleStartTime || "-",
        cycleEnd: row.cycleEndTime || "-",
        cycleTime: row.cycleTime || "0.00",
        endAt: row.plc_end_at || row.endAt || "-",
        endTime: row.endTime || "-",
        startAt: row.plc_start_at || row.startAt || "-",
        startTime: row.startTime || "-",
        status: row.statusLabel || row.industrialResult || row.result || "-",
        shotDate: row.shot_date || row.shotDate || "-",
        reason: row.interlock_reason || row.reason || "-",
        stationResults: {},
        plcReading: {},
      });
    }
    const bucket = grouped.get(partSerial);
    const machineName = String(row.machineName || row.machine_name || row?.Machine?.machine_name || "").trim();
    const op = String(row.operation_no || row.operationNo || row.stationNo || "").trim();
    const stationKey = machineName && op ? `${machineName}__${op}` : "";
    const resolved = row.industrialResult ? { status: row.industrialResult } : resolveIndustrialResult(row);
    const status = String(resolved.status || "").toUpperCase();
    if (stationKey) {
      const normalizedStatus = status === "OK" || status === "NG" ? status : "-";
      bucket.stationResults[stationKey] = pickPreferredStationResult(bucket.stationResults[stationKey], normalizedStatus);
    }
    const nextPlcReading = row.plcReading || {};
    Object.keys(nextPlcReading).forEach((key) => {
      if (bucket.plcReading[key] === undefined || bucket.plcReading[key] === null || bucket.plcReading[key] === "" || bucket.plcReading[key] === "-") {
        bucket.plcReading[key] = nextPlcReading[key];
      }
    });
  });

  const matrixRows = [...grouped.values()];

  const tableHeaderRow = 14;
  const baseColumns = [
    { header: "SR NO", width: 8 },
    { header: "Part Serial No", width: 28 },
    { header: "Date & Time", width: 22 },
    { header: "Part Name", width: 22 },
    { header: "Customer QR Code", width: 20 },
  ];
  const stationColumns = stationPairsFinal.map((s) => ({ header: s.label, width: 24 }));
  const finalColumn = [{ header: "Final Status", width: 16 }];
  const plcKeys = DEFAULT_PLC_CYCLE_COLUMNS;
  const formatPlcHeader = (key) => {
    const raw = String(key || "").trim().toLowerCase();
    const friendly = {
      machine_name: "Machine Name",
      shot_date: "Shot Date",
      shot_time: "Shot Time",
      shot_number: "Shot Number",
      shot_status: "Shot Status",
      cycle_time: "Cycle Time",
    };
    if (friendly[raw]) return friendly[raw];
    return String(key || "")
      .replaceAll("_", " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ");
  };
  const plcColumns = plcKeys.map((key) => ({
    header: formatPlcHeader(key),
    key,
    width: Math.min(Math.max(String(key).length + 6, 14), 28),
  }));
  const tailColumns = [{ header: "Reason / Remark", width: 34 }];
  const columns = [...baseColumns, ...stationColumns, ...finalColumn, ...plcColumns, ...tailColumns];

  columns.forEach((col, i) => {
    worksheet.getColumn(i + 1).width = col.width;
    const cell = worksheet.getCell(tableHeaderRow, i + 1);
    cell.value = col.header;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { bold: true, color: { argb: WHITE }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "medium", color: { argb: TEAL } } };
  });

  matrixRows.forEach((row, i) => {
    const stationResults = stationPairsFinal.map((s) => row.stationResults[s.key] || "-");
    const overall = stationResults.includes("NG") ? "NG" : (stationResults.length > 0 && stationResults.every((x) => x === "OK")) ? "PASSED" : "IN_PROGRESS";
    const plc = row.plcReading || {};
    const values = [
      i + 1,
      row.partSerial,
      row.cycleStart,
      (row.plcReading && row.plcReading.part_name) || "-",
      row.customerQrCode || row.customer_qr || "-",
      ...stationResults,
      overall,
      ...plcColumns.map((c) => {
        if (c.key === "shot_status") {
          const code = Number(plc.shot_status);
          return ({ 1: "OK", 3: "WARM UP SHOT", 5: "OFF SHOT" }[code] || (plc.shot_status ?? "-"));
        }
        if (c.key === "shot_date") {
          const y = plc.shot_year;
          const m = plc.shot_month;
          const d = plc.shot_day;
          if (y !== undefined && m !== undefined && d !== undefined && y !== null && m !== null && d !== null) {
            return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          }
          return plc.shot_date || "-";
        }
        if (c.key === "shot_time") {
          const hh = plc.shot_hour;
          const mm = plc.shot_minute;
          const ss = plc.shot_second;
          if (hh !== undefined && mm !== undefined && ss !== undefined && hh !== null && mm !== null && ss !== null) {
            return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
          }
          return "-";
        }
        const v = plc[c.key];
        return v === undefined || v === null || v === "" ? "-" : v;
      }),
      row.reason,
    ];

    const rowIndex = tableHeaderRow + 1 + i;
    worksheet.getRow(rowIndex).values = values;
    if (i % 2 !== 0) worksheet.getRow(rowIndex).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LTGRAY } };

    values.forEach((_, ci) => {
      const cell = worksheet.getCell(rowIndex, ci + 1);
      cell.border = {
        top: { style: "thin", color: { argb: BORDER } },
        bottom: { style: "thin", color: { argb: BORDER } },
        left: { style: "thin", color: { argb: BORDER } },
        right: { style: "thin", color: { argb: BORDER } },
      };
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      if (!cell.font || !cell.font.bold) cell.font = { size: 9 };
    });

    const overallCell = worksheet.getCell(rowIndex, baseColumns.length + stationColumns.length + 1);
    if (overall === "OK" || overall === "PASSED") overallCell.font = { bold: true, size: 9, color: { argb: "FF059669" } };
    if (overall === "NG") overallCell.font = { bold: true, size: 9, color: { argb: RED } };
    if (overall === "IN_PROGRESS") overallCell.font = { bold: true, size: 9, color: { argb: "FFD97706" } };

    stationPairsFinal.forEach((_, sIdx) => {
      const stationCell = worksheet.getCell(rowIndex, baseColumns.length + sIdx + 1);
      const v = String(stationCell.value || "").toUpperCase();
      if (v === "OK") stationCell.font = { bold: true, size: 9, color: { argb: "FF059669" } };
      if (v === "NG") stationCell.font = { bold: true, size: 9, color: { argb: RED } };
    });

    const shotStatusColIndex = columns.findIndex((c) => String(c.key || "") === "shot_status");
    if (shotStatusColIndex >= 0) {
      const shotStatusCell = worksheet.getCell(rowIndex, shotStatusColIndex + 1);
      const shotStatusText = String(shotStatusCell.value || "").toUpperCase();
      if (shotStatusText === "OK") {
        shotStatusCell.font = { bold: true, size: 9, color: { argb: "FF059669" } };
        shotStatusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F8EE" } };
      } else if (shotStatusText.includes("WARM")) {
        shotStatusCell.font = { bold: true, size: 9, color: { argb: "FFD97706" } };
        shotStatusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4E5" } };
      } else if (shotStatusText.includes("OFF")) {
        shotStatusCell.font = { bold: true, size: 9, color: { argb: RED } };
        shotStatusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEECEC" } };
      }
    }
  });

  worksheet.views = [{ state: "frozen", ySplit: tableHeaderRow }];
  worksheet.autoFilter = { from: { row: tableHeaderRow, column: 1 }, to: { row: tableHeaderRow, column: columns.length } };

  const footerRow = tableHeaderRow + matrixRows.length + 2;
  worksheet.mergeCells(footerRow, 1, footerRow, columns.length);
  const footer = worksheet.getCell(footerRow, 1);
  footer.value = `${reportConfig.footerText || "Industrial Document - Controlled Copy"}  ·  Records: ${matrixRows.length}  ·  Exported: ${formatIndustrialTimestamp(new Date())}`;
  footer.font = { italic: true, size: 8, color: { argb: GRAY } };
  footer.alignment = { horizontal: "center" };

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${filePrefix}_${nowStamp()}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.byteLength);
  res.send(Buffer.from(buffer));
}

module.exports = { generateIndustrialExcel };
