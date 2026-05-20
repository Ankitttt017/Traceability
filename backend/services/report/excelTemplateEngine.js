/**
 * excelTemplateEngine.js
 * Industrial-grade Excel template engine using ExcelJS.
 * No external date dependencies — uses reportFormatter utilities.
 */

const ExcelJS = require("exceljs");
const { formatIndustrialTimestamp, resolveIndustrialResult } = require("./reportFormatter");

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function generateIndustrialExcel(res, {
  rows = [],
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
  worksheet.mergeCells("A1:K1");
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
  worksheet.mergeCells("A2:K2");
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

  const stationOrder = [...new Set(rows.map((r) => String(r.operation_no || r.operationNo || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  const grouped = new Map();
  rows.forEach((row) => {
    const partSerial = row.part_id || row.partId || "-";
    if (!grouped.has(partSerial)) {
      grouped.set(partSerial, {
        partSerial,
        shift: row.shift_code || row.shiftCode || "-",
        machineName: row.machineName || "-",
        modelCode: row.modelCode || "-",
        modelName: row.qrFormatName || "-",
        lineName: row.lineName || "-",
        cycleStart: row.cycleStartTime || "-",
        cycleEnd: row.cycleEndTime || "-",
        cycleTime: row.cycleTime || "0.00",
        reason: row.interlock_reason || row.reason || "-",
        stationResults: {},
      });
    }
    const bucket = grouped.get(partSerial);
    const op = String(row.operation_no || row.operationNo || "").trim();
    const resolved = row.industrialResult ? { status: row.industrialResult } : resolveIndustrialResult(row);
    const status = String(resolved.status || "").toUpperCase();
    if (op) bucket.stationResults[op] = status === "OK" || status === "NG" ? status : "-";
  });

  const matrixRows = [...grouped.values()];

  const tableHeaderRow = 14;
  const baseColumns = [
    { header: "SR NO", width: 8 },
    { header: "Part Serial No", width: 28 },
    { header: "Shift", width: 12 },
    { header: "Machine Name", width: 22 },
    { header: "Model Code", width: 16 },
    { header: "Model Name", width: 22 },
    { header: "Overall Result", width: 16 },
    { header: "Reason", width: 34 },
    { header: "Cycle Start", width: 24 },
    { header: "Cycle End", width: 24 },
    { header: "Cycle Time (s)", width: 16 },
    { header: "Line No", width: 14 },
  ];
  const stationColumns = stationOrder.map((op) => ({ header: op, width: 12 }));
  const plcColumns = [
    { header: "Part Name", key: "part_name", width: 22 },
    { header: "Shot Time", key: "shot_time", width: 14 },
    { header: "Shot Date", key: "shot_date", width: 14 },
    { header: "Shot Number", key: "shot_number", width: 14 },
    { header: "OK Shot", key: "ok_shot", width: 10 },
    { header: "NG Shot", key: "ng_shot", width: 10 },
    { header: "PLC cycle_time", key: "cycle_time", width: 14 },
    { header: "die_close_core_in_time", key: "die_close_core_in_time", width: 20 },
    { header: "pouring_time", key: "pouring_time", width: 14 },
    { header: "shot_fwd_time", key: "shot_fwd_time", width: 14 },
    { header: "curing_time", key: "curing_time", width: 14 },
    { header: "die_open_core_out_time", key: "die_open_core_out_time", width: 20 },
    { header: "extract_time", key: "extract_time", width: 14 },
    { header: "ejector_time", key: "ejector_time", width: 14 },
    { header: "spray_time", key: "spray_time", width: 14 },
    { header: "v1_speed", key: "v1_speed", width: 12 },
    { header: "v2_speed", key: "v2_speed", width: 12 },
    { header: "v3_speed", key: "v3_speed", width: 12 },
    { header: "v4_speed", key: "v4_speed", width: 12 },
    { header: "accel_point", key: "accel_point", width: 12 },
    { header: "deaccel_point", key: "deaccel_point", width: 14 },
    { header: "metal_pressure", key: "metal_pressure", width: 14 },
    { header: "intensification_time", key: "intensification_time", width: 18 },
    { header: "biscuit_thickness", key: "biscuit_thickness", width: 16 },
    { header: "clamp_tonnage_he_low_pct", key: "clamp_tonnage_he_low_pct", width: 22 },
    { header: "clamp_tonnage_he_low_mn", key: "clamp_tonnage_he_low_mn", width: 22 },
    { header: "clamp_tonnage_op_up_pct", key: "clamp_tonnage_op_up_pct", width: 22 },
    { header: "clamp_tonnage_op_low_pct", key: "clamp_tonnage_op_low_pct", width: 22 },
    { header: "clamp_tonnage_he_up_pct", key: "clamp_tonnage_he_up_pct", width: 22 },
    { header: "vacuum_pressure", key: "vacuum_pressure", width: 16 },
    { header: "cooling_water_mov", key: "cooling_water_mov", width: 16 },
    { header: "cooling_water_sta", key: "cooling_water_sta", width: 16 },
    { header: "furnace_metal_temp", key: "furnace_metal_temp", width: 18 },
    { header: "clamp_force_pct", key: "clamp_force_pct", width: 14 },
    { header: "clamp_tonnage", key: "clamp_tonnage", width: 14 },
    { header: "shot_acc_pressure", key: "shot_acc_pressure", width: 16 },
    { header: "intensification_acc_pressure", key: "intensification_acc_pressure", width: 22 },
    { header: "jet_cooling_pressure", key: "jet_cooling_pressure", width: 18 },
    { header: "fixed_die_temp_f1", key: "fixed_die_temp_f1", width: 16 },
    { header: "fixed_die_temp_f2", key: "fixed_die_temp_f2", width: 16 },
    { header: "moving_die_temp_m1", key: "moving_die_temp_m1", width: 18 },
    { header: "moving_die_temp_m2", key: "moving_die_temp_m2", width: 18 },
    { header: "slide_temp_s1", key: "slide_temp_s1", width: 14 },
    { header: "manual_mode", key: "manual_mode", width: 12 },
    { header: "emergency_stop", key: "emergency_stop", width: 14 },
    { header: "hyd_oil_level_low", key: "hyd_oil_level_low", width: 16 },
    { header: "running_mode", key: "running_mode", width: 12 },
    { header: "hyd_pump_motor_overload", key: "hyd_pump_motor_overload", width: 20 },
    { header: "hyd_oil_high_temp", key: "hyd_oil_high_temp", width: 16 },
    { header: "servo_pump_overload", key: "servo_pump_overload", width: 18 },
    { header: "servo_pump_motor_high_temp", key: "servo_pump_motor_high_temp", width: 22 },
    { header: "die_close_step", key: "die_close_step", width: 12 },
    { header: "pouring_step", key: "pouring_step", width: 12 },
    { header: "shot_fwd_step", key: "shot_fwd_step", width: 12 },
    { header: "curing_step", key: "curing_step", width: 12 },
    { header: "die_open_step", key: "die_open_step", width: 12 },
    { header: "ejector_step", key: "ejector_step", width: 12 },
    { header: "extractor_step", key: "extractor_step", width: 12 },
    { header: "spray_step", key: "spray_step", width: 12 },
    { header: "cycle_end", key: "cycle_end", width: 12 }
  ];
  const columns = [...baseColumns, ...stationColumns, ...plcColumns];

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
    const stationResults = stationOrder.map((op) => row.stationResults[op] || "-");
    const overall = stationResults.includes("NG") ? "NG" : stationResults.includes("OK") ? "OK" : "-";
    const plc = row.plcReading || {};
    const values = [
      i + 1,
      row.partSerial,
      row.shift,
      row.machineName,
      row.modelCode,
      row.modelName,
      overall,
      row.reason,
      row.cycleStart,
      row.cycleEnd,
      row.cycleTime,
      row.lineName,
      ...stationResults,
      ...plcColumns.map((c) => {
        const v = plc[c.key];
        return v === undefined || v === null || v === "" ? "-" : v;
      }),
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

    const overallCell = worksheet.getCell(rowIndex, 7);
    if (overall === "OK") overallCell.font = { bold: true, size: 9, color: { argb: "FF059669" } };
    if (overall === "NG") overallCell.font = { bold: true, size: 9, color: { argb: RED } };

    stationOrder.forEach((_, sIdx) => {
      const stationCell = worksheet.getCell(rowIndex, baseColumns.length + sIdx + 1);
      const v = String(stationCell.value || "").toUpperCase();
      if (v === "OK") stationCell.font = { bold: true, size: 9, color: { argb: "FF059669" } };
      if (v === "NG") stationCell.font = { bold: true, size: 9, color: { argb: RED } };
    });
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
