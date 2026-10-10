/**
 * historicalExcelService.js — the Historical Report's Excel file.
 *
 * The download must show what the page shows: the same parts (same filter + order), the same columns in the same
 * order, the same values and the same totals. So this file is built from the SAME per-part data the page renders
 * (the page API's "clean" records of each part) with a port of the page's row shaping
 * (frontend/src/pages/Reports/HistoricalReportsPage.jsx → reportTable). Keep the two in step when changing either.
 *
 * Status vocabulary everywhere: "OK" | "NG" | "In Progress" (green / red / amber).
 */
const ExcelJS = require("exceljs");

const PLANT_TZ = "Asia/Kolkata";
const PLANT_OFFSET_MIN = Number(process.env.PLANT_UTC_OFFSET_MINUTES || 330);
const LEAK_TEST_OPERATION = "OP150";
const LEAK_TEST_SHARED_KEY = "__LEAK_TEST_OP150__";
const GATE_RESULT_KEY = "station__gateResult";
const DEFAULT_PLC_CYCLE_COLUMNS = [
  "machine_name", "shot_date", "shot_time", "shot_number", "cycle_time",
  "die_close_core_in_time", "pouring_time", "shot_fwd_time", "curing_time", "die_open_core_out_time",
  "ejector_time", "extract_time", "spray_time", "v1_speed", "v2_speed", "v3_speed", "v4_speed", "metal_pressure",
  "furnace_metal_temp", "cooling_water_mov", "cooling_water_sta", "accel_point", "deaccel_point", "intensification_time",
  "biscuit_thickness", "jet_cooling_pressure", "clamp_tonnage_he_low_pct", "clamp_tonnage_he_low_mn", "clamp_tonnage_op_up_pct",
  "clamp_tonnage_op_low_pct", "clamp_tonnage_he_up_pct", "vacuum_pressure", "clamp_force_pct", "clamp_tonnage", "shot_acc_pressure",
  "intensification_acc_pressure", "fixed_die_temp_f1", "fixed_die_temp_f2", "moving_die_temp_m1", "moving_die_temp_m2", "slide_temp_s1",
  "fix_1_flow", "fix_2_flow", "fix_3_flow", "mov_1_flow", "mov_2_flow", "mov_3_flow", "vacuum_pressure_mmhg",
  "average_die_clamp_tonnage_count", "time_for_stroke", "stroke", "shot_status",
];
const PLC_COLUMN_UNITS = {
  cycle_time: "s", die_close_core_in_time: "s", pouring_time: "s", shot_fwd_time: "s", curing_time: "s",
  die_open_core_out_time: "s", ejector_time: "s", extract_time: "s", spray_time: "s", intensification_time: "s",
  time_for_stroke: "s", v1_speed: "m/s", v2_speed: "m/s", v3_speed: "m/s", v4_speed: "m/s", metal_pressure: "bar",
  jet_cooling_pressure: "bar", vacuum_pressure: "mmHg", vacuum_pressure_mmhg: "mmHg", shot_acc_pressure: "bar",
  intensification_acc_pressure: "bar", furnace_metal_temp: "°C", fixed_die_temp_f1: "°C", fixed_die_temp_f2: "°C",
  moving_die_temp_m1: "°C", moving_die_temp_m2: "°C", slide_temp_s1: "°C", cooling_water_mov: "°C", cooling_water_sta: "°C",
  clamp_tonnage_he_low_pct: "%", clamp_tonnage_op_up_pct: "%", clamp_tonnage_op_low_pct: "%", clamp_tonnage_he_up_pct: "%",
  clamp_force_pct: "%", clamp_tonnage_he_low_mn: "MN", clamp_tonnage: "T", biscuit_thickness: "mm", accel_point: "mm",
  deaccel_point: "mm", stroke: "mm", fix_1_flow: "L/min", fix_2_flow: "L/min", fix_3_flow: "L/min", mov_1_flow: "L/min",
  mov_2_flow: "L/min", mov_3_flow: "L/min", average_die_clamp_tonnage_count: "count",
};
const LEAK_TEST_COLUMNS = [
  { key: "Body_Leak_Value", label: "Body Leak Value", unit: "mbar" },
  { key: "Gall_1", label: "Gall_1", unit: "mbar" },
  { key: "Gall_2", label: "Gall_2", unit: "mbar" },
  { key: "Cycle_Time", label: "Cycle Time", unit: "s" },
  { key: "Running_Mode", label: "Running Mode" },
  { key: "Dry_Wey_Both", label: "Dry/Wey" },
];
const withUnit = (label, unit) => (unit ? `${label} (${unit})` : label);

/* ── value helpers (ports of the page's helpers) ───────────────────────────────────────────────────────────── */
const statusLabel = (v) => {
  const s = String(v || "").trim().toUpperCase();
  if (s === "OK" || s === "PASSED" || s === "PASS") return "OK";
  if (s === "NG" || s === "FAILED" || s === "FAIL") return "NG";
  if (s === "IN_PROGRESS" || s === "WIP" || s === "IN PROGRESS") return "In Progress";
  return "-";
};
const normResult = (v, reason = "") => {
  const s = String(v || "").toUpperCase().trim();
  const r = String(reason || "").toUpperCase().trim();
  if (r === "NG_SHOT_STATUS" && ["BLOCK", "INTERLOCKED"].includes(s)) return "NG";
  if (["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(s)) return "OK";
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG", "INTERLOCKED"].includes(s)) return "NG";
  if (!s || s === "-" || s === "UNKNOWN") return "";
  return "IN_PROGRESS";
};
const resultRank = (v) => (v === "NG" ? 3 : v === "OK" ? 2 : v === "IN_PROGRESS" ? 1 : 0);
const pickPreferredResult = (cur, cand) => (resultRank(cand) > resultRank(cur) ? cand : (cur || cand));
const parseDateSafe = (value) => {
  if (!value || value === "-") return NaN;
  const t = new Date(value).getTime();
  if (!Number.isNaN(t)) return t;
  const t2 = new Date(String(value).replace(" ", "T")).getTime();
  return Number.isNaN(t2) ? NaN : t2;
};
// Excel has no time zones: a moment is written as the plant's wall-clock time
const toPlantExcelDate = (value) => {
  const t = parseDateSafe(value);
  return Number.isFinite(t) ? new Date(t + PLANT_OFFSET_MIN * 60000) : null;
};
// "2026-10-08 22:05:31" (PLC wall clock) → the same wall-clock date in Excel
const wallClockExcelDate = (text) => {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : null;
};
const formatPlantTime = (value) => {
  const t = parseDateSafe(value);
  return Number.isFinite(t) ? new Date(t).toLocaleString("en-IN", { timeZone: PLANT_TZ }) : String(value || "");
};
const readLabeledValue = (text, label) => {
  const match = String(text || "").match(new RegExp(`(?:^|\\|)\\s*${label}\\s*:\\s*([^|]+)`, "i"));
  return match ? match[1].trim() : "";
};
const splitRejectionZone = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { zone: "", subZone: "" };
  let zone = "";
  let subZone = "";
  raw.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean).forEach((part) => {
    const subMatch = part.match(/^sub\s*zone\s*[:-]?\s*(.+)$/i);
    if (subMatch) { subZone = subMatch[1].trim(); return; }
    const zoneMatch = part.match(/^zone\s*[:-]?\s*(.+)$/i);
    if (zoneMatch) { zone = zoneMatch[1].trim(); return; }
    if (!zone) zone = part;
  });
  return { zone: zone || raw, subZone };
};
const resolveRejectionDetails = (entries = []) => {
  const source = entries.find((row) => (
    row?.rejection?.category || row?.rejection?.reason || row?.rejection?.view || row?.rejection?.zone || row?.rejection?.subZone
    || String(row?.rejection?.reason || "").includes("Category:")
  )) || {};
  const text = String(source.rejection?.reason || "").trim();
  const zoneParts = splitRejectionZone(String(source.rejection?.zone || readLabeledValue(text, "Zone") || "").trim());
  return {
    category: String(source.rejection?.category || readLabeledValue(text, "Category") || "").trim(),
    rejection: String(source.rejection?.reason || readLabeledValue(text, "Reason") || "").trim(),
    view: String(source.rejection?.view || readLabeledValue(text, "View") || "").trim(),
    zone: zoneParts.zone,
    subZone: String(source.rejection?.subZone || readLabeledValue(text, "Sub Zone") || zoneParts.subZone || "").trim(),
  };
};
const normalizeLeakResult = (value) => {
  const token = String(value || "").trim().toUpperCase();
  if (!token) return "";
  if (token === "19279") return "OK";
  if (["NG", "NOK", "NOT_OK", "NOT OK", "FAIL", "FAILED", "REJECT", "REJECTED"].includes(token)) return "NG";
  if (["OK", "PASS", "PASSED", "GOOD"].includes(token)) return "OK";
  if (/^\d+$/.test(token) && Number(token) > 0) return "NG";
  return "";
};
const leakResultToken = (r = {}) => r?.Result ?? r?.result ?? r?.Raw_Result ?? r?.rawResult ?? "";
const leakTimeRaw = (r = {}) => r?.cycleEndAt || r?.cycleEndTime || r?.Cycle_End_Time || r?.updatedAt || r?.createdAt || "";
const sortLeakReadings = (leakData) => (Array.isArray(leakData) ? leakData : (leakData ? [leakData] : []))
  .filter((r) => r && typeof r === "object")
  .map((r, i) => ({ r, i, t: parseDateSafe(leakTimeRaw(r)) }))
  .sort((a, b) => ((Number.isFinite(a.t) && Number.isFinite(b.t)) ? a.t - b.t : 0) || a.i - b.i)
  .map((x) => x.r);
const leakHistoryOf = (leakData) => {
  const list = sortLeakReadings(leakData);
  const nested = list.map((r) => r.readings).find((x) => Array.isArray(x) && x.length > 0);
  return nested ? sortLeakReadings(nested) : list;
};
// plant rule: the LATEST leak test decides (NG then OK on a retest = OK), like the latest scan at every station
const leakStatusOf = (leakData) => {
  const history = leakHistoryOf(leakData);
  if (!history.length) return "";
  return normalizeLeakResult(leakResultToken(history[history.length - 1])) || "IN_PROGRESS";
};
const leakMachineOf = (r = {}) => String(r?.machine || r?.matchedMachineName || r?.Machine || r?.machineName || "").trim();
const leakHistorySummary = (history = []) => {
  if (history.length < 2) return "";
  const results = history.map((r) => normalizeLeakResult(leakResultToken(r)) || "?");
  return `${results.join(" → ")} (retest)`;
};
const leakHistoryDetail = (history = []) => {
  if (history.length < 2) return "";
  return history.map((r) => {
    const result = normalizeLeakResult(leakResultToken(r)) || "?";
    const raw = leakTimeRaw(r);
    const value = r?.bodyLeakValue ?? r?.Body_Leak_Value;
    const valueText = value !== undefined && value !== null && value !== "" && value !== "-" ? `(${value} mbar)` : "";
    return [leakMachineOf(r), result, raw ? formatPlantTime(raw) : "", valueText].filter(Boolean).join(" ");
  }).join(" → ");
};
const leakValueOf = (readings, key) => {
  const list = Array.isArray(readings) ? readings : (readings ? [readings] : []);
  if (!list.length) return "-";
  const truthy = (v) => v === true || String(v ?? "").trim().toUpperCase() === "TRUE" || String(v ?? "").trim() === "1";
  return list.map((r) => {
    if (!r) return "-";
    if (key === "Dry_Wey_Both") {
      if (truthy(r.both) || truthy(r.Both)) return "Both";
      if (truthy(r.dry) || truthy(r.Dry)) return "Dry";
      if (truthy(r.wey) || truthy(r.Wey) || truthy(r.way) || truthy(r.Way)) return "Wey";
      return "-";
    }
    if (key === "Body_Leak_Value") return r.bodyLeakValue ?? r.Body_Leak_Value ?? "-";
    if (key === "Gall_1") return r.gall1 ?? r.Gall_1 ?? "-";
    if (key === "Gall_2") return r.gall2 ?? r.Gall_2 ?? "-";
    if (key === "Cycle_Time") return r.cycleTime ?? r.Cycle_Time ?? "-";
    if (key === "Running_Mode") return r.runningMode ?? r.Running_Mode ?? "-";
    return r[key] ?? "-";
  }).join(" | ");
};
const INVALID_QR = new Set(["ERROR", "ERR", "FAILED", "FAIL", "NG", "WAIT", "WAITING", "PENDING", "IN_PROGRESS", "RUNNING",
  "PLC_COMM_ERROR", "COMM_ERROR", "TIMEOUT", "NULL", "UNDEFINED"]);
const looksLikeCustomerQr = (v) => /^R\d[A-Z0-9-]{10,}$/i.test(String(v || "").trim());
const collapseRepeatedQr = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const seg = raw.match(/R[^R]+/g);
  if (seg && seg.length > 1 && seg.join("") === raw && seg.every((s) => s === seg[0])) return seg[0];
  if (raw.length < 16) return raw;
  for (let size = Math.floor(raw.length / 2); size >= 8; size -= 1) {
    if (raw.length % size !== 0) continue;
    const token = raw.slice(0, size);
    if (token && token.repeat(raw.length / size) === raw) return token;
  }
  return raw;
};
const sanitizeCustomerQr = (value) => {
  const raw = collapseRepeatedQr(value);
  if (!raw || raw === "-" || INVALID_QR.has(raw.toUpperCase()) || !looksLikeCustomerQr(raw)) return "";
  return raw;
};
const splitPartDie = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return { partName: "", dieName: "" };
  const [partName, ...dieParts] = raw.split("-");
  return { partName: partName || "", dieName: dieParts.join("-") || "" };
};
const resultTimeOf = (row = {}) => [row.station?.cycleEndAt, row.production?.latestActivityAt].find((c) => c && c !== "-") || null;
const formatPlcLabel = (key) => {
  const friendly = { machine_name: "Machine Name", part_name: "Part Name", shot_date: "Shot Date", shot_time: "Shot Time", shot_number: "Shot Number", shot_status: "Shot Status" };
  if (friendly[key]) return friendly[key];
  return String(key).replace(/_/g, " ").replace(/\s+/g, " ").trim().split(" ").map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ").replace(/^Plc\s+/i, "");
};
const PLC_KEYS = DEFAULT_PLC_CYCLE_COLUMNS.filter((k) => !["machine_name", "part_name", "shot_number", "shot_date", "shot_time", "shot_datetime"].includes(k));
const PLC_COLUMNS = (() => {
  const used = new Map();
  return PLC_KEYS.map((key) => {
    const base = withUnit(formatPlcLabel(key), PLC_COLUMN_UNITS[key]);
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    return { key, label: n === 0 ? base : `${base} (${n + 1})` };
  });
})();

/* ── station columns ───────────────────────────────────────────────────────────────────────────────────────── */
// Machines (sequence_no, id order) → one column per operation, the leak machines share one; same as the page.
function stationPairsOf(machines = [], extra = []) {
  const map = new Map();
  const add = (machineName, op) => {
    const name = String(machineName || "").trim();
    const operation = String(op || "").trim();
    if (!name || !operation || /^[-–—\s]*$/.test(name) || /^[-–—\s]*$/.test(operation)) return;
    if (operation.toUpperCase() === LEAK_TEST_OPERATION) {
      if (!map.has(LEAK_TEST_SHARED_KEY)) map.set(LEAK_TEST_SHARED_KEY, { key: LEAK_TEST_SHARED_KEY, op: operation, machineName: "Leak Test", label: "OP150 · Leak Test", leak: true });
      return;
    }
    const key = operation.toUpperCase();
    if (!map.has(key)) map.set(key, { key, op: operation, machineName: name, label: `${key} · ${name}` });
  };
  machines.forEach((m) => add(m.machine_name || m.machineName, m.operation_no || m.operationNo || m.station_no || m.stationNo));
  extra.forEach((x) => add(x.machineName, x.op));
  return [...map.values()].sort((a, b) => a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) || a.machineName.localeCompare(b.machineName));
}

/* ── one part → one row (port of the page's reportTable row) ───────────────────────────────────────────────── */
/**
 * entries — the part's clean records (formatCleanReportResponse), oldest first
 * opts    — { gateView, gateOp: "OP130" | "OP150" | "" }
 * Returns plain values; dates as ISO strings / wall-clock text, statuses as OK / NG / IN_PROGRESS tokens.
 */
function shapeHistoricalPart(entries = [], { gateView = false, gateOp = "" } = {}) {
  const first = entries[0] || {};
  const partKey = String(first.part?.id || "").trim();
  const stationResults = {};
  const operationResults = {};
  const stationNames = {};
  const plcData = {};
  let leakData = null;
  entries.forEach((row) => {
    const op = String(row.station?.operation || "").trim();
    const key = op.toUpperCase();
    const leakList = Array.isArray(row.leakTest) && row.leakTest.length ? row.leakTest : null;
    if (!leakData && leakList) leakData = leakList;
    if (key) {
      const res = normResult(String(row.station?.result || "-").toUpperCase(), row.rejection?.reason);
      if (res) {
        stationResults[key] = pickPreferredResult(stationResults[key], res);
        operationResults[op] = pickPreferredResult(operationResults[op], res);
      }
      if (row.station?.name && !stationNames[key]) stationNames[key] = row.station.name;
    }
    const next = {
      shot_number: row.shot?.number, recordedAt: row.shot?.recordedAt, shot_date: row.shot?.date, shot_time: row.shot?.time,
      machine_name: row.shot?.machine, part_name: row.shot?.partDie, shot_status: row.shot?.status, ...(row.shot?.parameters || {}),
    };
    Object.keys(next).forEach((k) => {
      if (plcData[k] === undefined || plcData[k] === null || plcData[k] === "" || plcData[k] === "-") plcData[k] = next[k];
    });
  });
  const leakSorted = sortLeakReadings(leakData);
  const leakHistory = leakHistoryOf(leakData);
  const hasLeak = Boolean(leakData && leakData.length);
  let leakStatus = "";
  if (hasLeak) {
    leakStatus = leakStatusOf(leakData);
    // the latest leak test decides OP150 (a retest OK overrides an earlier NG)
    stationResults[LEAK_TEST_SHARED_KEY] = leakStatus || stationResults[LEAK_TEST_SHARED_KEY];
    operationResults[LEAK_TEST_OPERATION] = leakStatus || operationResults[LEAK_TEST_OPERATION];
  }
  // final status = the server's part status (exactly what the OK / NG / In progress figures count)
  const overall = normResult(first.__pr_overall_status) || "IN_PROGRESS";
  const gateResult = (() => {
    if (!gateView) return "";
    const stamped = String(first.__pr_gate_status || "").trim().toUpperCase();
    if (["OK", "NG", "IN_PROGRESS"].includes(stamped)) return stamped;
    const fromLogs = normResult(gateOp === LEAK_TEST_OPERATION ? stationResults[LEAK_TEST_SHARED_KEY] : operationResults[gateOp]);
    return fromLogs === "OK" || fromLogs === "NG" ? fromLogs : "";
  })();
  const finalResultAt = (() => {
    if (overall !== "OK" && overall !== "NG") return null;
    if (first.__pr_final_scan_at) return first.__pr_final_scan_at;
    return entries.reduce((latest, row) => {
      const t = resultTimeOf(row);
      return t && (!latest || parseDateSafe(t) > parseDateSafe(latest)) ? t : latest;
    }, null);
  })();
  const progressAt = (() => {
    if (overall === "OK" || overall === "NG") return "";
    const LINE = ["OP100", "OP110", "OP120", "OP130", "OP140", "OP150", "OP160"];
    const res = (op) => normResult(stationResults[op] || "");
    const passed = (op) => res(op) === "OK" || (op === "OP150" && hasLeak);
    const started = LINE.find((op) => res(op) === "IN_PROGRESS");
    if (started) return `Scan started at ${started} · no result yet`;
    const done = LINE.filter(passed);
    if (!done.length) return "Not scanned yet";
    const last = done[done.length - 1];
    const next = LINE[LINE.indexOf(last) + 1];
    return next ? `Passed ${last} · awaiting ${next}` : `Passed ${last}`;
  })();
  const rej = resolveRejectionDetails(entries);
  const hideRejection = gateView ? gateResult !== "NG" : overall === "OK";
  const partDie = splitPartDie(first.shot?.partDie || plcData.part_name || first.part?.label || first.part?.name || "");
  const customerQr = entries.map((row) => sanitizeCustomerQr(row.part?.customerQr || "")).find(Boolean) || (looksLikeCustomerQr(partKey) ? partKey : "");
  const shotNumber = entries.map((row) => String(row.shot?.number ?? "").trim()).find((v) => v && v !== "-") || "";
  const plc = {};
  PLC_KEYS.forEach((key) => {
    if (key === "shot_status") {
      const code = Number(plcData[key]);
      plc[key] = ({ 1: "OK", 3: "WARM UP SHOT", 5: "OFF SHOT" }[code] || (plcData[key] ?? "-"));
    } else {
      plc[key] = plcData[key] ?? "-";
    }
  });
  const leak = {};
  LEAK_TEST_COLUMNS.forEach(({ key }) => { leak[key] = leakValueOf(leakSorted.length ? leakSorted : leakData, key); });
  const leakNames = [...new Set((leakHistory.length ? leakHistory : leakSorted).map(leakMachineOf).filter(Boolean))];
  const leakSummary = leakHistorySummary(leakHistory);
  const leakMachineLabel = leakNames.join(" + ") || (leakSummary ? "Leak Test" : "");
  return {
    partSerial: looksLikeCustomerQr(partKey) ? "" : partKey,
    customerQr,
    dieName: partDie.dieName || String(first.part?.die || "").trim() || "",
    shotNumber: plcData.shot_number || shotNumber || "",
    shotDateTime: plcData.shot_datetime || [plcData.shot_date, plcData.shot_time].filter(Boolean).join(" ") || "",
    firstScanAt: first.__pr_first_scan_at || first.production?.firstScanAt || null,
    finalResultAt,
    gateScanAt: entries.find((r) => r.__pr_gate_scan_at)?.__pr_gate_scan_at || null,
    gateShift: entries.find((r) => r.__pr_gate_shift)?.__pr_gate_shift || "",
    gateResult,
    overall,
    progressAt,
    rejection: hideRejection
      ? { category: "", rejection: "", view: "", zone: "", subZone: "" }
      : rej,
    stations: stationResults,
    stationNames,
    leakCell: { machine: leakMachineLabel ? (leakSummary ? `${leakMachineLabel} · ${leakSummary}` : leakMachineLabel) : "", status: leakStatus },
    leakHistory: leakHistoryDetail(leakHistory),
    plc,
    leak,
  };
}

/* ── column set (same order as the page table) ─────────────────────────────────────────────────────────────── */
/**
 * view: { gateView, gateLabel, gateOp, isLeakGate, stationPairs, includeLeakHistory }
 * Each column: { key, header, width, type: "text" | "status" | "date" | "number" | "wallclock", get(row, i) }
 */
function buildHistoricalColumns({ gateView = false, gateLabel = "", gateOp = "", stationPairs = [], includeLeakHistory = false } = {}) {
  const dash = (v) => (v === null || v === undefined || v === "" ? "-" : v);
  const isLeakGate = gateView && gateOp === LEAK_TEST_OPERATION;
  const cols = [
    { key: "srNo", header: "#", width: 7, type: "number", get: (r, i) => i + 1 },
    { key: "plc_shot_number", header: "Shot #", width: 10, type: "number", get: (r) => dash(r.shotNumber) },
    { key: "shot_datetime", header: "Shot Date & Time", width: 20, type: "wallclock", get: (r) => dash(r.shotDateTime) },
    { key: "barcode", header: "Part Serial", width: 20, type: "text", get: (r) => r.partSerial || "" },
    { key: "customerCode", header: "Customer QR", width: 32, type: "text", get: (r) => dash(r.customerQr) },
    { key: "dieName", header: "Die", width: 9, type: "text", get: (r) => dash(r.dieName) },
  ];
  const rejectionCols = [
    { key: "rejectionCategory", header: "Category", width: 10, type: "category", get: (r) => dash(r.rejection.category) },
    { key: "rejectionReason", header: "Rejection", width: 26, type: "text", get: (r) => dash(r.rejection.rejection) },
    { key: "rejectionView", header: "View", width: 14, type: "text", get: (r) => dash(r.rejection.view) },
    { key: "rejectionZone", header: "Zone", width: 12, type: "text", get: (r) => dash(r.rejection.zone) },
    { key: "rejectionSubZone", header: "Sub Zone", width: 12, type: "text", get: (r) => dash(r.rejection.subZone) },
  ];
  const plcCols = PLC_COLUMNS.map((c) => ({
    key: `plc_${c.key}`, header: c.label, width: Math.min(Math.max(c.label.length + 2, 11), 26),
    type: c.key === "shot_status" ? "shot" : "number", get: (r) => r.plc[c.key],
  }));
  const leakCols = LEAK_TEST_COLUMNS.map((c) => ({
    key: `leak_${c.key}`, header: withUnit(c.label, c.unit), width: 15, type: c.unit ? "number" : "text", get: (r) => r.leak[c.key],
  }));
  const leakHistoryCol = { key: "leakHistory", header: "Leak Test History", width: 60, type: "text", get: (r) => dash(r.leakHistory) };
  const finalCol = { key: "overallStatus", header: "Final Status", width: 13, type: "status", get: (r) => r.overall };
  if (gateView) {
    const gateResultCol = { key: GATE_RESULT_KEY, header: `${gateLabel} Result`, width: Math.max(16, gateLabel.length + 9), type: "status", get: (r) => r.gateResult || "-" };
    return [
      ...cols,
      { key: "gateScanAt", header: "Station Scan Time", width: 20, type: "date", get: (r) => r.gateScanAt },
      { key: "gateShift", header: "Station Shift", width: 12, type: "text", get: (r) => dash(r.gateShift) },
      ...(includeLeakHistory ? [leakHistoryCol] : []),
      gateResultCol,
      ...rejectionCols,
      // gate view: the gate's own result only (no Final Status); the shot parameters whenever the part has a shot,
      // the leak readings from the leak test onwards (leak gate, Final Inspection)
      ...plcCols,
      ...(isLeakGate || gateOp === "OP160" ? leakCols : []),
    ];
  }
  return [
    ...cols,
    { key: "createdAt", header: "First Scan", width: 20, type: "date", get: (r) => r.firstScanAt },
    { key: "finalResultAt", header: "Final Result Time", width: 20, type: "date", get: (r) => r.finalResultAt },
    ...stationPairs.map((s) => ({
      key: `station_${s.key}`, header: s.label, width: s.leak ? 30 : Math.max(14, s.label.length + 2), type: s.leak ? "leakStation" : "status",
      get: (r) => {
        if (s.leak) {
          if (!r.leakCell.machine || !r.leakCell.status) return "-";
          return `${statusLabel(r.leakCell.status)} · ${r.leakCell.machine}`;
        }
        return r.stations[s.key] || "-";
      },
    })),
    ...(includeLeakHistory ? [leakHistoryCol] : []),
    finalCol,
    { key: "progressAt", header: "Where is it", width: 30, type: "text", get: (r) => dash(r.progressAt) },
    ...rejectionCols,
    ...plcCols,
    ...leakCols,
  ];
}

/* ── workbook ──────────────────────────────────────────────────────────────────────────────────────────────── */
const C = {
  navy: "FF1A3A7C", navy2: "FF2D5BA3", white: "FFFFFFFF", border: "FFD1D5DB", zebra: "FFF8FAFC", label: "FF475569", muted: "FF64748B",
  ok: "FF15803D", okBg: "FFDCFCE7", ng: "FFB91C1C", ngBg: "FFFEE2E2", wip: "FFB45309", wipBg: "FFFEF3C7",
  cr: "FF2563EB", mr: "FF7C3AED", cram: "FFEA580C",
};
const STATUS_STYLE = {
  OK: { font: C.ok, fill: C.okBg },
  NG: { font: C.ng, fill: C.ngBg },
  "In Progress": { font: C.wip, fill: C.wipBg },
};
const CATEGORY_COLOR = { CR: C.cr, MR: C.mr, CRAM: C.cram };
const thin = { style: "thin", color: { argb: C.border } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const DATE_FMT = "dd/mm/yyyy hh:mm:ss";
const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));
const colLetter = (n) => { let s = ""; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };

/**
 * Streams the report into `filePath`.
 *   columns — buildHistoricalColumns(); rows — shapeHistoricalPart() results (page order)
 *   meta    — { title, period, shift, gate, status, search, generatedAt, company }
 *   summary — { gateView, gateLabel, total, ok, ng, inProgress, passRate, ngCategories, wipNote }
 */
async function writeHistoricalWorkbook(filePath, options) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  try {
    return await writeSheet(workbook, options);
  } catch (err) {
    // cancelled / failed half way: close the file so it can be deleted (Windows keeps open files locked)
    try { workbook.stream?.destroy?.(); } catch (e) { void e; }
    throw err;
  }
}

async function writeSheet(workbook, { columns, rows, meta = {}, summary = {}, sheetName = "Historical Report", onProgress, isCancelled = () => false }) {
  workbook.creator = "Traceability";
  workbook.created = new Date();
  // title block + summary, then the table; header row frozen together with the first 5 columns (#, shot, part, QR)
  const metaRows = [
    ["Period", meta.period || "-"],
    ["Shift", meta.shift || "All shifts"],
    ["Quality gate", meta.gate || "All stations"],
    ["Status filter", meta.status || "All"],
    ...(meta.search ? [["Search", meta.search]] : []),
    ["Generated", meta.generatedAt || formatPlantTime(new Date())],
  ];
  const ngc = summary.ngCategories || { CR: 0, MR: 0, CRAM: 0 };
  const summaryRows = [
    [summary.gateView ? `Inspected at ${summary.gateLabel} (OK + NG)` : "Total parts (OK + NG + In Progress)", summary.total, null],
    ["OK", summary.ok, "OK"],
    ["NG", summary.ng, "NG", `CR ${ngc.CR}  ·  MR ${ngc.MR}  ·  CRAM ${ngc.CRAM}`],
    [summary.gateView ? `In Progress (waiting for ${summary.gateLabel}, not in total)` : "In Progress", summary.inProgress, "In Progress", summary.wipNote || ""],
    ["Pass rate (OK / (OK + NG))", (summary.ok + summary.ng) > 0 ? Number((Number(summary.passRate || 0) / 100).toFixed(4)) : null, "pct"],
  ];
  const titleRows = 2;
  const metaStart = titleRows + 2; // one blank row after the title
  const summaryStart = metaStart + metaRows.length + 1;
  const headerRow = summaryStart + 1 + summaryRows.length + 1;
  const freezeCols = 5;
  const ws = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: freezeCols, ySplit: headerRow, topLeftCell: `${colLetter(freezeCols + 1)}${headerRow + 1}`, zoomScale: 90 }],
    properties: { defaultRowHeight: 16 },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerRow}:${headerRow}` },
  });
  const lastCol = columns.length;
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 14; });

  // 1–2: title
  ws.mergeCells(1, 1, 1, Math.min(lastCol, 12));
  const t = ws.getCell(1, 1);
  t.value = meta.title || "Traceability Report";
  t.font = { bold: true, size: 16, color: { argb: C.white } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 28;
  ws.getRow(1).commit();
  ws.mergeCells(2, 1, 2, Math.min(lastCol, 12));
  const st = ws.getCell(2, 1);
  st.value = meta.subtitle || "";
  st.font = { size: 10, color: { argb: C.white } };
  st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy2 } };
  st.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(2).height = 18;
  ws.getRow(2).commit();

  // filters
  metaRows.forEach(([label, value], i) => {
    const r = ws.getRow(metaStart + i);
    r.getCell(1).value = label;
    r.getCell(1).font = { bold: true, size: 10, color: { argb: C.label } };
    ws.mergeCells(metaStart + i, 2, metaStart + i, 6);
    r.getCell(2).value = value;
    r.getCell(2).font = { size: 10 };
    r.commit();
  });

  // summary (same figures as the page cards)
  const sh = ws.getRow(summaryStart);
  sh.getCell(1).value = "Summary";
  sh.getCell(1).font = { bold: true, size: 11, color: { argb: C.navy } };
  sh.commit();
  summaryRows.forEach(([label, value, kind, note], i) => {
    const rn = summaryStart + 1 + i;
    const r = ws.getRow(rn);
    ws.mergeCells(rn, 1, rn, 3);
    const lc = r.getCell(1);
    lc.value = label;
    lc.font = { bold: true, size: 10, color: { argb: STATUS_STYLE[kind]?.font || C.label } };
    lc.border = BORDER;
    const vc = r.getCell(4);
    vc.value = value;
    vc.numFmt = kind === "pct" ? "0.00%" : "#,##0";
    vc.font = { bold: true, size: 11, color: { argb: STATUS_STYLE[kind]?.font || "FF0F172A" } };
    vc.alignment = { horizontal: "right" };
    vc.border = BORDER;
    if (STATUS_STYLE[kind]) vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_STYLE[kind].fill } };
    if (kind === "NG") {
      // CR / MR / CRAM next to the NG figure, each in its colour
      [["CR", ngc.CR], ["MR", ngc.MR], ["CRAM", ngc.CRAM]].forEach(([cat, n], k) => {
        const cc = r.getCell(5 + k);
        cc.value = { richText: [{ text: `${cat} `, font: { bold: true, size: 10, color: { argb: CATEGORY_COLOR[cat] } } }, { text: Number(n || 0).toLocaleString("en-IN"), font: { bold: true, size: 10 } }] };
        cc.border = BORDER;
        cc.alignment = { horizontal: "center" };
      });
    } else if (note) {
      ws.mergeCells(rn, 5, rn, 9);
      r.getCell(5).value = note;
      r.getCell(5).font = { italic: true, size: 9, color: { argb: C.muted } };
    }
    r.commit();
  });

  // header
  const hr = ws.getRow(headerRow);
  hr.height = 30;
  columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9, color: { argb: C.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER;
  });
  hr.commit();

  // data
  const styleCache = new Map();
  const styleFor = (key, build) => { let s = styleCache.get(key); if (!s) { s = build(); styleCache.set(key, s); } return s; };
  const total = rows.length;
  for (let i = 0; i < total; i += 1) {
    if (i % 200 === 0 && isCancelled()) throw Object.assign(new Error("Export cancelled"), { cancelled: true });
    const row = rows[i];
    const r = ws.getRow(headerRow + 1 + i);
    const zebra = i % 2 === 1;
    columns.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      let v = c.get(row, i);
      let kind = c.type;
      if (kind === "status") {
        v = statusLabel(v);
        kind = STATUS_STYLE[v] ? `status:${v}` : "text";
      } else if (kind === "leakStation") {
        const head = String(v || "").split(" · ")[0];
        kind = STATUS_STYLE[head] ? `status:${head}` : "text";
      } else if (kind === "date") {
        const d = toPlantExcelDate(v);
        v = d || "-";
        kind = d ? "date" : "text";
      } else if (kind === "wallclock") {
        const d = wallClockExcelDate(v);
        v = d || (v === null || v === undefined || v === "" ? "-" : v);
        kind = d ? "date" : "text";
      } else if (kind === "number") {
        const n = typeof v === "number" ? v : (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
        if (n !== null && Number.isFinite(n)) { v = n; kind = Number.isInteger(n) ? "int" : "dec"; } else { v = v === null || v === undefined || v === "" ? "-" : v; kind = "text"; }
      } else if (kind === "category") {
        kind = CATEGORY_COLOR[v] ? `cat:${v}` : "text";
      } else if (kind === "shot") {
        const s = String(v || "").toUpperCase();
        kind = s === "OK" ? "status:OK" : s.includes("WARM") ? "status:In Progress" : (s.includes("OFF") || s.includes("NG")) ? "status:NG" : "text";
      } else {
        v = v === null || v === undefined || v === "" ? (c.key === "barcode" ? "" : "-") : v;
        kind = "text";
      }
      cell.value = v;
      cell.style = styleFor(`${kind}|${zebra ? 1 : 0}`, () => {
        const s = { border: BORDER, font: { size: 9 }, alignment: { vertical: "middle" } };
        if (zebra) s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.zebra } };
        if (kind.startsWith("status:")) {
          const ss = STATUS_STYLE[kind.slice(7)];
          s.font = { size: 9, bold: true, color: { argb: ss.font } };
          s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ss.fill } };
          s.alignment = { vertical: "middle", horizontal: "center" };
        } else if (kind.startsWith("cat:")) {
          s.font = { size: 9, bold: true, color: { argb: CATEGORY_COLOR[kind.slice(4)] } };
          s.alignment = { vertical: "middle", horizontal: "center" };
        } else if (kind === "date") {
          s.numFmt = DATE_FMT;
          s.alignment = { vertical: "middle", horizontal: "center" };
        } else if (kind === "int") {
          s.numFmt = "0";
          s.alignment = { vertical: "middle", horizontal: "right" };
        } else if (kind === "dec") {
          s.numFmt = "0.00";
          s.alignment = { vertical: "middle", horizontal: "right" };
        }
        return s;
      });
    });
    r.commit();
    rows[i] = null; // written — let it go
    if (i % 250 === 249) {
      if (onProgress) onProgress(i + 1, total);
      await yieldToLoop();
    }
  }
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: lastCol } };
  const fr = ws.getRow(headerRow + total + 2);
  fr.getCell(1).value = `${total.toLocaleString("en-IN")} parts · ${meta.footer || "Traceability system export"} · generated ${meta.generatedAt || formatPlantTime(new Date())}`;
  fr.getCell(1).font = { italic: true, size: 8, color: { argb: C.muted } };
  fr.commit();
  ws.commit();
  await workbook.commit();
  if (onProgress) onProgress(total, total);
  return { records: total, headerRow };
}

module.exports = {
  shapeHistoricalPart,
  buildHistoricalColumns,
  stationPairsOf,
  writeHistoricalWorkbook,
  statusLabel,
  formatPlantTime,
  LEAK_TEST_OPERATION,
};
