/**
 * excelTemplateEngine.js
 * Industrial-grade Excel template engine using ExcelJS.
 * No external date dependencies — uses reportFormatter utilities.
 */

const ExcelJS = require("exceljs");
const { formatIndustrialTimestamp, resolveIndustrialResult } = require("./reportFormatter");
const { Op } = require("sequelize");
const PartCodeMapping = require("../../models/PartCodeMapping");
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
const LEAK_TEST_COLUMNS = [
  { key: "Body_Leak_Value", header: "Body Leak Value", unit: "mbar", width: 18 },
  { key: "Gall_1", header: "Gall_1", unit: "mbar", width: 14 },
  { key: "Gall_2", header: "Gall_2", unit: "mbar", width: 14 },
  { key: "Cycle_Time", header: "Cycle Time", unit: "s", width: 14 },
  { key: "Running_Mode", header: "Running Mode", width: 16 },
  { key: "Dry_Wey_Both", header: "Dry/Wey", width: 14 },
];
const PLC_COLUMN_UNITS = {
  cycle_time: "s",
  die_close_core_in_time: "s",
  pouring_time: "s",
  shot_fwd_time: "s",
  curing_time: "s",
  die_open_core_out_time: "s",
  ejector_time: "s",
  extract_time: "s",
  spray_time: "s",
  intensification_time: "s",
  time_for_stroke: "s",
  v1_speed: "m/s",
  v2_speed: "m/s",
  v3_speed: "m/s",
  v4_speed: "m/s",
  metal_pressure: "bar",
  jet_cooling_pressure: "bar",
  vacuum_pressure: "mmHg",
  vacuum_pressure_mmhg: "mmHg",
  shot_acc_pressure: "bar",
  intensification_acc_pressure: "bar",
  furnace_metal_temp: "°C",
  fixed_die_temp_f1: "°C",
  fixed_die_temp_f2: "°C",
  moving_die_temp_m1: "°C",
  moving_die_temp_m2: "°C",
  slide_temp_s1: "°C",
  cooling_water_mov: "°C",
  cooling_water_sta: "°C",
  clamp_tonnage_he_low_pct: "%",
  clamp_tonnage_op_up_pct: "%",
  clamp_tonnage_op_low_pct: "%",
  clamp_tonnage_he_up_pct: "%",
  clamp_force_pct: "%",
  clamp_tonnage_he_low_mn: "MN",
  clamp_tonnage: "T",
  biscuit_thickness: "mm",
  accel_point: "mm",
  deaccel_point: "mm",
  stroke: "mm",
  fix_1_flow: "L/min",
  fix_2_flow: "L/min",
  fix_3_flow: "L/min",
  mov_1_flow: "L/min",
  mov_2_flow: "L/min",
  mov_3_flow: "L/min",
  average_die_clamp_tonnage_count: "count",
};
const withUnit = (label, unit) => unit ? `${label} (${unit})` : label;
const LEAK_TEST_SHARED_KEY = "__LEAK_TEST_OP150__";

function splitRejectionZone(value) {
  const raw = String(value || "").trim();
  if (!raw) return { zone: "", subZone: "" };
  const parts = raw.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  let zone = "";
  let subZone = "";
  parts.forEach((part) => {
    const subMatch = part.match(/^sub\s*zone\s*[:\-]?\s*(.+)$/i);
    if (subMatch) {
      subZone = subMatch[1].trim();
      return;
    }
    const zoneMatch = part.match(/^zone\s*[:\-]?\s*(.+)$/i);
    if (zoneMatch) {
      zone = zoneMatch[1].trim();
      return;
    }
    if (!zone) zone = part;
  });
  return { zone: zone || raw, subZone };
}

function readLabeledValue(text, label) {
  const match = String(text || "").match(new RegExp(`(?:^|\\|)\\s*${label}\\s*:\\s*([^|]+)`, "i"));
  return match ? match[1].trim() : "";
}

function resolveRejectionDetails(row = {}) {
  const text = String(row.reason || row.interlock_reason || "").trim();
  const category = String(row.rejectionCategory || row.rejection_category || readLabeledValue(text, "Category") || "").trim();
  const rejection = String(row.rejectionReason || row.rejection_reason || readLabeledValue(text, "Reason") || "").trim();
  const view = String(row.rejectionView || row.rejection_view || readLabeledValue(text, "View") || "").trim();
  const zoneRaw = String(row.rejectionZone || row.rejection_zone || readLabeledValue(text, "Zone") || "").trim();
  const zoneParts = splitRejectionZone(zoneRaw);
  const subZone = String(row.rejectionSubZone || row.rejection_sub_zone || readLabeledValue(text, "Sub Zone") || zoneParts.subZone || "").trim();
  return {
    category,
    rejection,
    view,
    zone: zoneParts.zone,
    subZone,
  };
}

function stationResultRank(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "NG") return 3;
  if (normalized === "OK") return 2;
  if (normalized === "IN_PROGRESS") return 1;
  return 0;
}

function pickPreferredStationResult(currentValue, nextValue) {
  return stationResultRank(nextValue) > stationResultRank(currentValue) ? nextValue : (currentValue || nextValue);
}
function getStationResultStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized || normalized === "-") return "-";
  if (/\bNG\b|NOK|FAILED|FAIL/.test(normalized)) return "NG";
  if (/\bOK\b|PASSED|PASS/.test(normalized)) return "OK";
  if (normalized.includes("IN_PROGRESS") || normalized.includes("IN PROGRESS")) return "IN_PROGRESS";
  return normalized;
}
function pickPreferredStationDisplay(currentValue, nextValue) {
  const currentRank = stationResultRank(getStationResultStatus(currentValue));
  const nextRank = stationResultRank(getStationResultStatus(nextValue));
  return nextRank > currentRank ? nextValue : (currentValue || nextValue);
}
function buildStationPair(machineName, op) {
  const operation = String(op || "").trim().toUpperCase();
  if (!operation) return null;
  if (operation === LEAK_TEST_OPERATION) {
    return {
      key: LEAK_TEST_SHARED_KEY,
      machineName: "Leak Test",
      op: LEAK_TEST_OPERATION,
      label: "Leak Test OP150",
      sharedLeakOperation: true,
    };
  }
  const name = String(machineName || "").trim();
  if (!name) return null;
  return { key: `${name}__${operation}`, machineName: name, op: operation, label: `${name} + ${operation}` };
}
function normalizeFinalPartStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (["OK", "PASSED", "PASS", "COMPLETED", "COMPLETED_OK", "ENDED_OK"].includes(status)) return "PASSED";
  if (["NG", "FAILED", "FAIL", "REJECTED", "INTERLOCKED", "COMPLETED_NG", "ENDED_NG"].includes(status)) return "NG";
  return "IN_PROGRESS";
}
function normalizeLeakResult(value) {
  const token = String(value || "").trim().toUpperCase();
  if (!token) return "";
  if (["NG", "NOK", "NOT_OK", "NOT OK", "FAIL", "FAILED", "REJECT", "REJECTED"].includes(token)) return "NG";
  if (["OK", "PASS", "PASSED", "GOOD"].includes(token)) return "OK";
  return "OK";
}
function getLeakTestStatus(reading) {
  const result = normalizeLeakResult(reading?.Result || reading?.result);
  if (result === "OK") return "OK";
  if (result === "NG") return "NG";
  return "-";
}
function getLeakTestValue(readings, key) {
  if (!readings) return "-";
  const readingsArray = Array.isArray(readings) ? readings : [readings];
  if (readingsArray.length === 0) return "-";

  return readingsArray.map(reading => {
    if (!reading) return "-";
    if (key === "Dry_Wey_Both") {
      const isTruthy = (value) => value === true || String(value ?? "").trim().toUpperCase() === "TRUE" || String(value ?? "").trim() === "1";
      if (isTruthy(reading.Both)) return "Both";
      if (isTruthy(reading.Dry)) return "Dry";
      if (isTruthy(reading.Wey) || isTruthy(reading.Way)) return "Wey";
      return "-";
    }
    if (key === "Machine") return reading.Machine || reading.machineName || reading.matchedMachineName || "-";
    if (key === "Cycle_End_Time") {
      const raw = reading.Cycle_End_Time || reading.cycleEndTime || "";
      return raw ? formatIndustrialTimestamp(raw) : "-";
    }
    const value = reading[key];
    if (key === "Running_Mode") {
      const normalizedMode = String(value ?? "").trim();
      if (!normalizedMode) return "-";
      const upper = normalizedMode.toUpperCase();
      if (upper === "MANUAL") return "Manual";
      if (upper === "AUTO" || upper === "AUTOMATIC") return "Auto";
      return normalizedMode;
    }
    return value !== undefined && value !== null && value !== "" ? value : "-";
  }).join(" | ");
}

function getCustomerQrFromRow(row = {}) {
  return String(
    row.customerQrCode ||
    row.customerCode ||
    row.customer_qr ||
    row.customerQRCode ||
    row.customerQR ||
    row.mappedCustomerQr ||
    row.mappedCustomerQrCode ||
    ""
  ).trim();
}

function getExcelGroupKey(row = {}, fallback = "") {
  return String(
    row.reportGroupKey ||
    row.report_group_key ||
    row.traceabilityPartId ||
    row.traceability_part_id ||
    row.displayPartId ||
    row.display_part_id ||
    row.partId ||
    row.part_id ||
    row.barcode ||
    row.shot_uid ||
    fallback ||
    ""
  ).trim();
}

function getDisplayPartSerial(row = {}, fallback = "-") {
  return String(
    row.displayPartId ||
    row.display_part_id ||
    row.traceabilityPartId ||
    row.traceability_part_id ||
    row.partId ||
    row.part_id ||
    fallback ||
    "-"
  ).trim() || "-";
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
    const station = buildStationPair(s.machineName, s.op);
    if (!station) return;
    stationMap.set(station.key, station);
  });
  rows.forEach((row) => {
    const machineName = String(row.machineName || row.machine_name || row?.Machine?.machine_name || "").trim();
    const op = String(row.operation_no || row.operationNo || row.stationNo || "").trim();
    const station = buildStationPair(machineName, op);
    if (station && !stationMap.has(station.key)) stationMap.set(station.key, station);
  });
  const stationPairsFinal = Array.from(stationMap.values()).sort((a, b) =>
    a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) || a.machineName.localeCompare(b.machineName)
  );
  const requiredOperations = Array.from(
    new Set(
      stationPairsFinal
        .map((station) => String(station.op || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const grouped = new Map();
  rows.forEach((row, index) => {
    const groupKey = getExcelGroupKey(row, `row_${index}`);
    const partSerial = getDisplayPartSerial(row, groupKey);
    const rejectionDetails = resolveRejectionDetails(row);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        groupKey,
        partSerial,
        partName: row.partName || row.part_name || row.modelName || row.componentName || "",
        partDieLabel: row.partDieLabel || "",
        qualityGateName: row.anchorMachineName || row.anchor_machine_name || row.machineName || row.machine_name || "-",
        dieCastingMachineName: row.plcReading?.machine_name || row.plc_reading?.machine_name || row.dieCastingMachine || row.die_casting_machine || "",
        customerQrCode: getCustomerQrFromRow(row) || "-",
        createdAt: row.firstScanCreatedAt || row.createdAt || row.created_at || "-",
        finalResultAt: row.finalResultCreatedAt || row.finalResultAt || row.cycleEndAt || row.plc_end_at || row.plcEndAt || "",
        cycleStart: row.cycleStartTime || "-",
        cycleEnd: row.cycleEndTime || "-",
        cycleTime: row.cycleTime || "0.00",
        endAt: row.plc_end_at || row.endAt || "-",
        endTime: row.endTime || "-",
        startAt: row.plc_start_at || row.startAt || "-",
        startTime: row.startTime || "-",
        status: row.statusLabel || row.industrialResult || row.result || "-",
        partStatus: row.partStatus || row.part_status || row.status || "",
        shotDate: row.shot_date || row.shotDate || "-",
        reason: row.interlock_reason || row.reason || "-",
        rejectionCategory: rejectionDetails.category,
        rejectionReason: rejectionDetails.rejection,
        rejectionView: rejectionDetails.view,
        rejectionZone: rejectionDetails.zone,
        rejectionSubZone: rejectionDetails.subZone,
        stationResults: {},
        plcReading: {},
        leakTestReading: row.leakTestReading || null,
      });
    }
    const bucket = grouped.get(groupKey);
    const nextPartSerial = getDisplayPartSerial(row, bucket.partSerial);
    if ((!bucket.partSerial || bucket.partSerial === "-") && nextPartSerial) {
      bucket.partSerial = nextPartSerial;
    }
    if (!bucket.partName && (row.partName || row.part_name || row.modelName || row.componentName)) {
      bucket.partName = row.partName || row.part_name || row.modelName || row.componentName;
    }
    if ((!bucket.qualityGateName || bucket.qualityGateName === "-") && (row.anchorMachineName || row.anchor_machine_name || row.machineName || row.machine_name)) {
      bucket.qualityGateName = row.anchorMachineName || row.anchor_machine_name || row.machineName || row.machine_name;
    }
    if (!bucket.dieCastingMachineName && (row.plcReading?.machine_name || row.plc_reading?.machine_name || row.dieCastingMachine || row.die_casting_machine)) {
      bucket.dieCastingMachineName = row.plcReading?.machine_name || row.plc_reading?.machine_name || row.dieCastingMachine || row.die_casting_machine;
    }
    if (!bucket.finalResultAt && (row.finalResultCreatedAt || row.finalResultAt || row.cycleEndAt || row.plc_end_at || row.plcEndAt)) {
      bucket.finalResultAt = row.finalResultCreatedAt || row.finalResultAt || row.cycleEndAt || row.plc_end_at || row.plcEndAt;
    }
    if (!bucket.partDieLabel && row.partDieLabel) {
      bucket.partDieLabel = row.partDieLabel;
    }
    if (!bucket.partStatus && (row.partStatus || row.part_status || row.status)) {
      bucket.partStatus = row.partStatus || row.part_status || row.status;
    }
    const rowCustomerQr = getCustomerQrFromRow(row);
    if ((!bucket.customerQrCode || bucket.customerQrCode === "-") && rowCustomerQr) {
      bucket.customerQrCode = rowCustomerQr;
    }
    if (!bucket.rejectionCategory && rejectionDetails.category) bucket.rejectionCategory = rejectionDetails.category;
    if (!bucket.rejectionReason && rejectionDetails.rejection) bucket.rejectionReason = rejectionDetails.rejection;
    if (!bucket.rejectionView && rejectionDetails.view) bucket.rejectionView = rejectionDetails.view;
    if (!bucket.rejectionZone && rejectionDetails.zone) bucket.rejectionZone = rejectionDetails.zone;
    if (!bucket.rejectionSubZone && rejectionDetails.subZone) bucket.rejectionSubZone = rejectionDetails.subZone;
    const machineName = String(row.machineName || row.machine_name || row?.Machine?.machine_name || "").trim();
    const op = String(row.operation_no || row.operationNo || row.stationNo || "").trim();
    const station = buildStationPair(machineName, op);
    const stationKey = station?.key || "";
    const resolved = row.industrialResult ? { status: row.industrialResult } : resolveIndustrialResult(row);
    const status = String(resolved.status || "").toUpperCase();
    if (stationKey && String(op || "").trim().toUpperCase() !== LEAK_TEST_OPERATION) {
      const normalizedStatus = status === "OK" || status === "NG" || status === "IN_PROGRESS" ? status : "-";
      bucket.stationResults[stationKey] = pickPreferredStationResult(bucket.stationResults[stationKey], normalizedStatus);
    } else if (stationKey && String(op || "").trim().toUpperCase() === LEAK_TEST_OPERATION) {
      const normalizedStatus = status === "OK" || status === "NG" || status === "IN_PROGRESS" ? status : "-";
      const displayStatus = machineName && normalizedStatus !== "-"
        ? `${machineName} ${normalizedStatus}`
        : normalizedStatus;
      bucket.stationResults[stationKey] = pickPreferredStationDisplay(bucket.stationResults[stationKey], displayStatus);
    }
    const nextPlcReading = row.plcReading || {};
    Object.keys(nextPlcReading).forEach((key) => {
      if (bucket.plcReading[key] === undefined || bucket.plcReading[key] === null || bucket.plcReading[key] === "" || bucket.plcReading[key] === "-") {
        bucket.plcReading[key] = nextPlcReading[key];
      }
    });
    if (!bucket.dieCastingMachineName && bucket.plcReading.machine_name) {
      bucket.dieCastingMachineName = bucket.plcReading.machine_name;
    }
    if (!bucket.leakTestReadings && row.leakTestReadings) {
      bucket.leakTestReadings = row.leakTestReadings;
    }
    if (!bucket.leakTestReading && row.leakTestReading) {
      bucket.leakTestReading = row.leakTestReading;
    }
    if (bucket.leakTestReading) {
      const leakMachineName = String(
        bucket.leakTestReading.matchedMachineName || bucket.leakTestReading.Machine || bucket.leakTestReading.machineName || ""
      ).trim();
      const leakStatus = getLeakTestStatus(bucket.leakTestReading);
      const leakDisplay = leakMachineName && leakStatus !== "-" ? `${leakMachineName} ${leakStatus}` : leakStatus;
      bucket.stationResults[LEAK_TEST_SHARED_KEY] = pickPreferredStationDisplay(bucket.stationResults[LEAK_TEST_SHARED_KEY], leakDisplay);
    }
  });

  const matrixRows = [...grouped.values()];
  const missingCustomerQrPartIds = matrixRows
    .filter((row) => !row.customerQrCode || row.customerQrCode === "-")
    .map((row) => String(row.partSerial || "").trim())
    .filter(Boolean);
  if (missingCustomerQrPartIds.length > 0) {
    const mappings = await PartCodeMapping.findAll({
      where: {
        [Op.or]: [
          { old_part_id: { [Op.in]: [...new Set(missingCustomerQrPartIds)] } },
          { customer_qr: { [Op.in]: [...new Set(missingCustomerQrPartIds)] } },
        ],
        is_active: true,
      },
      attributes: ["old_part_id", "customer_qr"],
      raw: true,
    });
    const qrByPart = mappings.reduce((acc, row) => {
      const partId = String(row.old_part_id || "").trim().toUpperCase();
      const customerQr = String(row.customer_qr || "").trim();
      if (partId && customerQr && !acc[partId]) acc[partId] = customerQr;
      if (customerQr && !acc[customerQr.toUpperCase()]) acc[customerQr.toUpperCase()] = customerQr;
      return acc;
    }, {});
    matrixRows.forEach((row) => {
      const mappedQr = qrByPart[String(row.partSerial || "").trim().toUpperCase()];
      if (mappedQr && (!row.customerQrCode || row.customerQrCode === "-")) {
        row.customerQrCode = mappedQr;
      }
    });
  }

  const tableHeaderRow = 14;
  const baseColumns = [
    { header: "SR NO", width: 8 },
    { header: "Shot Number", width: 14 },
    { header: "Part Serial No.", width: 28 },
    { header: "Customer QR Code", width: 20 },
    { header: "Part Name", width: 22 },
    { header: "Die Casting Machine", width: 22 },
    { header: "First Scan Date & Time", width: 22 },
    { header: "Final Result Date & Time", width: 22 },
  ];
  const stationColumns = stationPairsFinal.map((s) => ({ header: s.label, width: 24 }));
  const finalColumn = [{ header: "Final Status", width: 16 }];
  const rejectionColumns = [
    { header: "Category", width: 18 },
    { header: "Rejection", width: 24 },
    { header: "View", width: 18 },
    { header: "Zone", width: 16 },
    { header: "Sub Zone", width: 16 },
  ];
  const plcKeys = ["shot_datetime", ...DEFAULT_PLC_CYCLE_COLUMNS.filter((key) => !["machine_name", "shot_number", "shot_date", "shot_time"].includes(key))];
  const formatPlcHeader = (key) => {
    const raw = String(key || "").trim().toLowerCase();
    const friendly = {
      machine_name: "Machine Name",
      shot_date: "Shot Date",
      shot_time: "Shot Time",
      shot_number: "Shot Number",
      shot_datetime: "Shot Date & Time",
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
    header: withUnit(formatPlcHeader(key), PLC_COLUMN_UNITS[key]),
    key,
    width: Math.min(Math.max(String(key).length + 6, 14), 28),
  }));
  const tailColumns = [
    ...LEAK_TEST_COLUMNS.map((column) => ({
      ...column,
      header: withUnit(column.header, column.unit),
    })),
  ];
  const columns = [...baseColumns, ...stationColumns, ...finalColumn, ...rejectionColumns, ...plcColumns, ...tailColumns];

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
    const operationResults = requiredOperations.map((operation) => {
      const operationStationResults = stationPairsFinal
        .filter((station) => String(station.op || "").trim().toUpperCase() === operation)
        .map((station) => getStationResultStatus(row.stationResults[station.key] || "-"));
      if (operationStationResults.includes("NG")) return "NG";
      if (operationStationResults.includes("OK")) return "OK";
      if (operationStationResults.includes("IN_PROGRESS")) return "IN_PROGRESS";
      return "-";
    });
    const finalPartStatus = normalizeFinalPartStatus(row.partStatus);
    const overall = operationResults.includes("NG")
      ? "NG"
      : operationResults.includes("IN_PROGRESS")
        ? "IN_PROGRESS"
        : finalPartStatus === "NG"
          ? "NG"
          : requiredOperations.length > 1 && operationResults.length >= requiredOperations.length && operationResults.every((value) => value === "OK")
            ? "PASSED"
          : finalPartStatus === "PASSED"
            ? "PASSED"
            : "IN_PROGRESS";
    const plc = row.plcReading || {};
    const shotNumber = plc.shot_number || row.shotNumber || row.shot_number || "-";
    const exportPartName =
      plc.part_name ||
      row.partName ||
      row.part_name ||
      row.modelName ||
      row.componentName ||
      row.partDieLabel ||
      "-";
    const values = [
      i + 1,
      shotNumber,
      row.partSerial,
      getCustomerQrFromRow(row) || row.customerQrCode || "-",
      exportPartName,
      row.dieCastingMachineName || row.plcReading?.machine_name || "-",
      row.cycleStart,
      row.finalResultAt ? formatIndustrialTimestamp(row.finalResultAt) : "-",
      ...stationResults,
      overall,
      row.rejectionCategory || "-",
      row.rejectionReason || "-",
      row.rejectionView || "-",
      row.rejectionZone || "-",
      row.rejectionSubZone || "-",
      ...plcColumns.map((c) => {
        if (c.key === "shot_datetime") {
          const y = plc.shot_year;
          const m = plc.shot_month;
          const d = plc.shot_day;
          const hh = plc.shot_hour;
          const mm = plc.shot_minute;
          const ss = plc.shot_second;
          if (y !== undefined && m !== undefined && d !== undefined && hh !== undefined && mm !== undefined && ss !== undefined) {
            return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
          }
          return `${plc.shot_date || "-"} ${plc.shot_time || ""}`.trim();
        }
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
      ...LEAK_TEST_COLUMNS.map((column) => getLeakTestValue(row.leakTestReadings?.length > 0 ? row.leakTestReadings : row.leakTestReading, column.key)),
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
      const v = getStationResultStatus(stationCell.value);
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

  const filename = `${filePrefix}_${nowStamp()}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { generateIndustrialExcel };
