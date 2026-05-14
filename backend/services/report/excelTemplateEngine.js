/**
 * excelTemplateEngine.js
 * Industrial-grade Excel template engine using ExcelJS.
 * No external date dependencies — uses reportFormatter utilities.
 */

const ExcelJS = require("exceljs");
const { formatIndustrialTimestamp, resolveIndustrialResult } = require("./reportFormatter");

/** Native timestamp for filenames: YYYYMMDD_HHmm */
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

  // ── Color tokens ──────────────────────────────────────────────────────────
  const NAVY   = "FF1A3A7C";
  const RED    = "FFC8191E";
  const TEAL   = "FF0D9488";
  const GRAY   = "FF4B5563";
  const WHITE  = "FFFFFFFF";
  const LTGRAY = "FFF9FAFB";
  const BORDER = "FFD1D5DB";

  // ── 1. COMPANY HEADER & LOGO ──────────────────────────────────────────────
  worksheet.getRow(1).height = 65; // Increased for better logo visibility
  worksheet.mergeCells("A1:K1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = (reportConfig.headerLine1 || reportConfig.companyName || "Industrial Traceability System").toUpperCase();
  titleCell.font  = { bold: true, size: 20, color: { argb: WHITE }, name: "Calibri" };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };

  // Add Logo if available
  if (reportConfig.logoUrl && reportConfig.showLogo) {
    try {
      let base64Data = reportConfig.logoUrl;
      if (base64Data.includes(",")) {
        base64Data = base64Data.split(",")[1];
      }
      
      if (base64Data && base64Data.length > 50) {
        const imageId = workbook.addImage({
          base64: base64Data,
          extension: 'png',
        });
        worksheet.addImage(imageId, {
          tl: { col: 0.1, row: 0.1 },
          ext: { width: 90, height: 55 } // Optimized logo dimensions
        });
      }
    } catch (e) {
      console.warn("Logo addition failed:", e.message);
    }
  }

  worksheet.getRow(2).height = 32; // Increased for subtitle
  worksheet.mergeCells("A2:K2");
  const subTitleCell = worksheet.getCell("A2");
  
  // Dynamic Subtitle based on filters
  let subText = reportConfig.headerLine2 || "TRACEABILITY PRODUCTION REPORT";
  if (filters.machineId) subText += ` - MACHINE: ${filters.machineId}`;
  else if (filters.lineName) subText += ` - LINE: ${filters.lineName}`;
  
  subTitleCell.value = subText.toUpperCase();
  subTitleCell.font  = { bold: true, size: 14, color: { argb: WHITE } };
  subTitleCell.alignment = { horizontal: "center", vertical: "middle" };
  subTitleCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2D5BA3" } };

  // ── 2. METADATA BLOCK ─────────────────────────────────────────────────────
  // Set widths for metadata area to avoid truncation
  worksheet.getColumn(1).width = 18;
  worksheet.getColumn(4).width = 18;

  const metaRows = [
    ["Report Type",  sheetName,                              "Generated At", formatIndustrialTimestamp(new Date())],
    ["Line",         filters.lineName   || "All Lines",      "Date From",    formatIndustrialTimestamp(filters.dateFrom)],
    ["Machine",      filters.machineId  || "All Machines",   "Date To",      formatIndustrialTimestamp(filters.dateTo)],
    ["Shift",        filters.shiftCode  || "All Shifts",     "Plant",        reportConfig.plantName    || "-"],
    ["Department",   reportConfig.department || "-",         "Prepared By",  reportConfig.preparedBy   || "-"],
  ];

  metaRows.forEach((r, i) => {
    const rowNum = i + 4;
    worksheet.getRow(rowNum).height = 20; // Increased for readability
    const set = (col, val, bold) => {
      const c = worksheet.getCell(`${col}${rowNum}`);
      c.value = val;
      c.font  = bold ? { bold: true, size: 10, color: { argb: NAVY } } : { size: 10 };
      c.alignment = { vertical: "middle" };
      c.border = {
        top:    { style: "thin", color: { argb: BORDER } },
        bottom: { style: "thin", color: { argb: BORDER } },
        left:   { style: "thin", color: { argb: BORDER } },
        right:  { style: "thin", color: { argb: BORDER } },
      };
    };
    set("A", r[0], true);
    set("B", r[1], false);
    set("D", r[2], true);
    set("E", r[3], false);
    
    // Also add border to empty column C for consistency if needed
    const emptyC = worksheet.getCell(`C${rowNum}`);
    emptyC.border = {
      top:    { style: "thin", color: { argb: BORDER } },
      bottom: { style: "thin", color: { argb: BORDER } },
      left:   { style: "thin", color: { argb: BORDER } },
      right:  { style: "thin", color: { argb: BORDER } },
    };
  });

  // ── 3. SUMMARY SECTION ────────────────────────────────────────────────────
  const summaryStart = 10;
  worksheet.mergeCells(`A${summaryStart}:K${summaryStart}`);
  const sumHeader = worksheet.getCell(`A${summaryStart}`);
  sumHeader.value = "PRODUCTION SUMMARY";
  sumHeader.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  sumHeader.font  = { bold: true, size: 10, color: { argb: NAVY } };
  sumHeader.alignment = { horizontal: "left", indent: 1 };
  sumHeader.border = { bottom: { style: "medium", color: { argb: NAVY } } };
  worksheet.getRow(summaryStart).height = 20;

  const summaryCards = [
    { label: "Total Production",    value: metrics.totalProduction    || 0,  color: NAVY },
    { label: "Total OK",            value: metrics.totalOK            || 0,  color: "FF059669" },
    { label: "Total NG",            value: metrics.totalNG            || 0,  color: RED },
    { label: "Validation Rejects",  value: metrics.validationRejects  || 0,  color: "FFD97706" },
    { label: "Pass Rate",           value: `${metrics.passRate        || 0}%`, color: TEAL },
  ];

  summaryCards.forEach((card, i) => {
    const col = i * 2 + 1;
    const lbl = worksheet.getCell(summaryStart + 1, col);
    lbl.value = card.label;
    lbl.font  = { bold: true, size: 8, color: { argb: GRAY } };
    lbl.alignment = { horizontal: "center" };

    const val = worksheet.getCell(summaryStart + 2, col);
    val.value = card.value;
    val.font  = { bold: true, size: 14, color: { argb: card.color } };
    val.alignment = { horizontal: "center" };
  });
  worksheet.getRow(summaryStart + 1).height = 16;
  worksheet.getRow(summaryStart + 2).height = 24;

  // ── 4. TABLE HEADER ───────────────────────────────────────────────────────
  const tableHeaderRow = 14;
  const columns = [
    { header: "SR NO",           width: 8 },
    { header: "Part Serial No",  width: 28 },
    { header: "Timestamp",       width: 24 },
    { header: "Shift",           width: 12 },
    { header: "Operation No",    width: 16 },
    { header: "Machine Name",    width: 22 },
    { header: "Model Code",      width: 16 },
    { header: "Model Name",      width: 22 },
    { header: "Result",          width: 16 },
    { header: "Reason",          width: 34 },
    { header: "Cycle Time (s)",  width: 16 },
    { header: "Line No",         width: 14 },
  ];

  columns.forEach((col, i) => {
    worksheet.getColumn(i + 1).width = col.width;
    const cell = worksheet.getCell(tableHeaderRow, i + 1);
    cell.value = col.header;
    cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font  = { bold: true, color: { argb: WHITE }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "medium", color: { argb: TEAL } } };
  });
  worksheet.getRow(tableHeaderRow).height = 22;

  // ── 5. DATA ROWS ──────────────────────────────────────────────────────────
  rows.forEach((row, i) => {
    const resolved = row.industrialResult
      ? { status: row.industrialResult }
      : resolveIndustrialResult(row);
    const status = resolved.status;

    const values = [
      i + 1, // SR NO
      row.part_id      || row.partId      || "-",
      formatIndustrialTimestamp(row.createdAt),
      row.shift_code   || row.shiftCode   || "A",
      row.operation_no || row.operationNo || "-",
      row.machineName  || "-",
      row.modelCode    || "-",
      row.qrFormatName || "-",
      status,
      row.interlock_reason || "-",
      row.cycleTime    || "0.00",
      row.lineName     || "-",
    ];

    const rowIndex = tableHeaderRow + 1 + i;
    worksheet.getRow(rowIndex).values = values;
    worksheet.getRow(rowIndex).height = 17;

    // Alternate row shade
    if (i % 2 !== 0) {
      worksheet.getRow(rowIndex).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LTGRAY } };
    }

    // Result cell color
    const resultCell = worksheet.getCell(rowIndex, 9);
    if (status === "OK") {
      resultCell.font = { bold: true, size: 9, color: { argb: "FF059669" } };
    } else if (status === "NG") {
      resultCell.font = { bold: true, size: 9, color: { argb: RED } };
    } else if (status.includes("VALIDATION") || status.includes("DUPLICATE") || status.includes("PREVIOUS")) {
      resultCell.font = { italic: true, size: 9, color: { argb: "FFD97706" } };
    } else {
      resultCell.font = { italic: true, size: 9, color: { argb: GRAY } };
    }

    // Cell borders & alignment
    values.forEach((_, ci) => {
      const cell = worksheet.getCell(rowIndex, ci + 1);
      cell.border = {
        top:    { style: "thin", color: { argb: BORDER } },
        bottom: { style: "thin", color: { argb: BORDER } },
        left:   { style: "thin", color: { argb: BORDER } },
        right:  { style: "thin", color: { argb: BORDER } },
      };
      if (ci !== 8 && (!cell.font || !cell.font.bold)) {
        cell.font = { size: 9 };
      }
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    });
  });

  // ── 6. FOOTER & FINALIZE ──────────────────────────────────────────────────
  worksheet.views = [{ state: "frozen", ySplit: tableHeaderRow }];
  worksheet.autoFilter = {
    from: { row: tableHeaderRow, column: 1 },
    to:   { row: tableHeaderRow, column: 11 },
  };

  const footerRow = tableHeaderRow + rows.length + 2;
  worksheet.mergeCells(`A${footerRow}:K${footerRow}`);
  const footer = worksheet.getCell(`A${footerRow}`);
  footer.value = `${reportConfig.footerText || "Industrial Document — Controlled Copy"}  ·  Records: ${rows.length}  ·  Exported: ${formatIndustrialTimestamp(new Date())}`;
  footer.font  = { italic: true, size: 8, color: { argb: GRAY } };
  footer.alignment = { horizontal: "center" };

  // ── 7. SEND ───────────────────────────────────────────────────────────────
  const buffer   = await workbook.xlsx.writeBuffer();
  const filename = `${filePrefix}_${nowStamp()}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.byteLength);
  res.send(Buffer.from(buffer));
}

module.exports = { generateIndustrialExcel };


module.exports = { generateIndustrialExcel };
