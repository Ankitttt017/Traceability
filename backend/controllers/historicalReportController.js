const { Op } = require("sequelize");
const sequelize = require("../config/db");
const ProductionReport = require("../models/ProductionReport");
const { _private: reportPrivate } = require("./reportController");

/* ═══════════════════════════════════════════════════════════════════════════
   Shared filter builder for the historical report page AND its Excel export
   (both used to carry their own copy of this logic).

   Quality gates:
   - OP100–OP140 / OP160 are logged in OperationLogs and station_keys → filter on those.
   - Leak test OP150 is NOT logged there: the three leak machines (Leak-Test-01/02/03, all operation_no
     OP150) write their result into ProductionReports.leak_data (JSON: matchedMachineId, result …).
     So a leak gate is filtered and counted from leak_data, per machine or all three together.
   Status:
   - A part is NG when overall_status is NG, OR any station status is NG, OR its leak result is NG —
     the same definition Rejection Analysis uses (leak fails often keep overall_status IN_PROGRESS / PASSED).
   All user values go through sequelize.escape (the old code pasted them into SQL strings).
   ═══════════════════════════════════════════════════════════════════════════ */
const { productionWindow, shiftCaseSql, PLANT_OFFSET_MIN } = require("../utils/productionDay");
const OK_VALUES = ["OK", "PASS", "PASSED", "ENDED_OK", "COMPLETED_OK"];
const NG_VALUES = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"];
const sqlList = (vals) => vals.map((v) => `'${v}'`).join(", ");
const LEAK_JSON = (path) => `(CASE WHEN ISJSON(leak_data) = 1 THEN JSON_VALUE(leak_data, '${path}') END)`;
const LEAK_RESULT = `UPPER(${LEAK_JSON("$.result")})`;
const PART_NG = `(overall_status IN ('NG', 'FAILED')`
  + ["op100", "op110", "op120", "op130", "op140", "op150", "op160"].map((op) => ` OR ${op}_status IN (${sqlList(NG_VALUES)})`).join("")
  + ` OR ${LEAK_RESULT} IN (${sqlList(NG_VALUES)}))`;
// Leak result time. leak_data.cycleEndTime is the plant's LOCAL clock written with a "Z" suffix, so it is shifted
// back to UTC here (all other timestamps are real UTC).
const LEAK_TIME_UTC = `DATEADD(MINUTE, -${PLANT_OFFSET_MIN}, TRY_CAST(${LEAK_JSON("$.cycleEndTime")} AS datetime2))`;
const leakTimeUtcOf = (leakData) => {
  let ld = leakData;
  if (typeof ld === "string") { try { ld = JSON.parse(ld); } catch (e) { void e; return null; } }
  if (Array.isArray(ld)) ld = ld[ld.length - 1];
  const raw = ld?.cycleEndTime || ld?.Cycle_End_Time;
  const t = raw ? new Date(String(raw).replace(/Z$|[+-]d{2}:d{2}$/, "") + "Z").getTime() : NaN;
  return Number.isNaN(t) ? null : new Date(t - PLANT_OFFSET_MIN * 60000).toISOString();
};
const PART_STATUS = `(CASE WHEN ${PART_NG} THEN 'NG' WHEN overall_status IN (${sqlList(OK_VALUES)}) THEN 'OK' ELSE 'IN_PROGRESS' END)`;
// One row per part. Two syncs running at the same moment used to create a second row for a new part (250 parts);
// one copy stayed IN_PROGRESS while the other completed, so a part was counted twice — e.g. as OK and as "in
// progress" at OP160 — and the stats did not match the table. The newest row is kept (the sync now always updates
// the newest row); a simple id comparison keeps the query on the part_id index.
const LATEST_ROW_SQL = require("../utils/productionDay").notStaleRowSql("[ProductionReport].[id]");

async function resolveGateScope(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return { stationScope: "", leak: null };
  const upper = value.toUpperCase();
  if (upper === "OP150" || upper === "LEAK" || upper === "LEAK TEST") return { stationScope: "OP150", leak: { machineId: null } };
  if (/^OP\d{3}$/.test(upper)) return { stationScope: upper, leak: null };
  let machine = null;
  try {
    const Machine = require("../models/Machine");
    machine = await Machine.findOne({
      where: /^\d+$/.test(value) ? { id: Number(value) } : { machine_name: value },
      attributes: ["id", "machine_name", "operation_no", "machine_type"],
      raw: true,
    });
  } catch (err) { void err; }
  if (!machine) return { stationScope: upper, leak: null };
  const op = String(machine.operation_no || "").trim().toUpperCase();
  if (op === "OP150" || String(machine.machine_type || "").toUpperCase() === "LEAK") {
    return { stationScope: "OP150", leak: { machineId: Number(machine.id), machineName: machine.machine_name } };
  }
  return { stationScope: op || upper, leak: null };
}

function gateStatusSql(stationScope) {
  const st = sequelize.escape(stationScope);
  return `(SELECT TOP 1 UPPER(o.result) FROM OperationLogs o
    WHERE o.part_id IN ([ProductionReport].[part_id], [ProductionReport].[customer_qr])
      AND (o.operation_no = ${st} OR o.station_no = ${st}) AND UPPER(o.result) IN ('OK', 'NG')
    ORDER BY o.createdAt DESC, o.id DESC)`;
}

async function buildHistoricalWhere(q = {}) {
  const { stationScope, leak } = await resolveGateScope(q.machineId || q.operationNo || q.stationNo || q.station);
  const esc = (v) => sequelize.escape(v);
  const where = {};
  const and = [];
  const reqStatus = String(q.status || "").trim().toUpperCase();
  const wantOk = reqStatus === "OK" || reqStatus === "PASSED";
  const wantNg = reqStatus === "NG" || reqStatus === "FAILED";
  const wantWip = reqStatus === "WIP" || reqStatus === "IN_PROGRESS";
  const isGate = Boolean(stationScope) && !leak;
  let gateTimeUsed = false;

  // ── Date + shift ─────────────────────────────────────────────────────────────────────────────────────────────
  // Production day: a date D = D 06:00:00 → D+1 06:00:00 (end exclusive). Shift: Shift Management timings, end second
  // inclusive (A 06:00:00–14:29:59, B 14:30:00–22:59:59, C 23:00:00–05:59:59). The TIME that decides both:
  //  • no station selected  → the part's FIRST scan (casting), so every part is counted once, on the day it was made
  //  • station selected     → that station's own scan time, i.e. the station's output in that day / shift — what the
  //                           production team counts. (Pre Inspection works hours after casting: its 12:00–14:30 work
  //                           is Shift A output even though those parts were cast earlier, or on the previous day.)
  //  • leak test (OP150)    → the leak result time (leak tests are not in OperationLogs)
  const win = q.dateFrom && q.dateTo ? productionWindow({ dateFrom: q.dateFrom, dateTo: q.dateTo }) : null;
  const shiftDefs = q.shiftCode
    ? await sequelize.query("SELECT shift_code, start_time, end_time FROM Shifts WHERE is_active = 1", { type: sequelize.QueryTypes.SELECT })
    : [];
  const timeFilter = (col) => {
    const parts = [];
    if (win) parts.push(`${col} >= ${esc(win.from.toISOString())} AND ${col} < ${esc(win.to.toISOString())}`);
    if (q.shiftCode && shiftDefs.length) parts.push(`${shiftCaseSql(col, shiftDefs)} = ${esc(q.shiftCode)}`);
    return parts.join(" AND ");
  };
  if (q.shiftCode && !shiftDefs.length) where.shift_code = q.shiftCode;

  if (isGate) {
    // A part scanned more than once at the station (re-check / rework) counts once: its LATEST scan there decides
    // the day and shift — otherwise it appeared in two shifts and A + B + C exceeded the full day.
    const gateTime = timeFilter("MAX(createdAt)");
    gateTimeUsed = Boolean(gateTime);
    // only logs from the window start (index on createdAt): a latest scan inside the window is always >= its start
    const since = win ? ` AND createdAt >= ${esc(win.from.toISOString())}` : "";
    // placeholder IDs ("-", fragments) are not parts: they matched every row whose customer QR was "-"
    // Only OK / NG scans decide: a BLOCK (part re-scanned after it was already checked, refused by the interlock)
    // does not change the part's result or move it to another shift.
    const sub = `SELECT part_id FROM OperationLogs WHERE (operation_no = ${esc(stationScope)} OR station_no = ${esc(stationScope)}) AND LEN(part_id) >= 7 AND UPPER(result) IN ('OK', 'NG')${since} GROUP BY part_id${gateTime ? ` HAVING ${gateTime}` : ""}`;
    // The newest report row of each part scanned at the station (matched by part ID or by its customer QR).
    // Written as joins + one id list: "part_id IN (…) OR customer_qr IN (…)" made SQL Server pick plans that took
    // up to 60 s.
    const gateRows = `SELECT MAX(pr.id) FROM ProductionReports pr JOIN (${sub}) g ON g.part_id = pr.part_id GROUP BY pr.part_id
      UNION SELECT MAX(pr.id) FROM ProductionReports pr JOIN (${sub}) g ON g.part_id = pr.customer_qr GROUP BY pr.part_id`;
    const viaLogs = [{ id: { [Op.in]: sequelize.literal(`(${gateRows})`) } }];
    // with no date/shift, also accept parts whose station list shows the gate
    and.push({ [Op.or]: gateTime ? viaLogs : [...viaLogs, { station_keys: { [Op.like]: `%${stationScope}%` } }] });
  } else {
    const t = timeFilter(leak ? LEAK_TIME_UTC : "first_scan_at");
    if (t) and.push(sequelize.literal(`(${t})`));
  }

  // Part / shot / QR search: literal text (SQL LIKE wildcards escaped); a search with no letters or digits
  // (e.g. "-") would match every part, so it is ignored
  const rawTerm = String(q.barcode || q.customerCode || q.partId || "").trim();
  if (/[A-Za-z0-9]/.test(rawTerm)) {
    const term = rawTerm.replace(/[!%_[]/g, (ch) => `!${ch}`);
    const like = esc(`%${term}%`);
    and.push({ [Op.or]: [
      sequelize.literal(`part_id LIKE ${like} ESCAPE '!'`),
      sequelize.literal(`customer_qr LIKE ${like} ESCAPE '!'`),
      sequelize.literal(`CAST(shot_number AS NVARCHAR(50)) LIKE ${like} ESCAPE '!'`),
    ] });
  }

  // status column / expression the metrics are grouped by
  let statusExpr;
  if (leak) {
    statusExpr = LEAK_RESULT;
    // only parts with a leak result from the selected machine (or from any leak machine)
    and.push(sequelize.literal(leak.machineId
      ? `${LEAK_JSON("$.matchedMachineId")} = ${esc(String(leak.machineId))}`
      : `${LEAK_RESULT} IS NOT NULL`));
    if (wantOk) and.push(sequelize.literal(`${LEAK_RESULT} IN (${sqlList(OK_VALUES)})`));
    else if (wantNg) and.push(sequelize.literal(`${LEAK_RESULT} IN (${sqlList(NG_VALUES)})`));
    else if (wantWip) and.push(sequelize.literal("1 = 0")); // a leak result is always final
  } else if (isGate) {
    // Station result = the result of the part's latest OK / NG scan at that station (from the scan log itself, so
    // stats and table always agree). Station total = OK + NG; a station has no "in progress".
    statusExpr = gateStatusSql(stationScope);
    if (wantOk) and.push(sequelize.literal(`${statusExpr} = 'OK'`));
    else if (wantNg) and.push(sequelize.literal(`${statusExpr} = 'NG'`));
    else if (wantWip) and.push(sequelize.literal("1 = 0"));
  } else {
    statusExpr = PART_STATUS;
    if (wantOk) and.push(sequelize.literal(`${PART_STATUS} = 'OK'`));
    else if (wantNg) and.push(sequelize.literal(`${PART_STATUS} = 'NG'`));
    else if (wantWip) and.push(sequelize.literal(`${PART_STATUS} = 'IN_PROGRESS'`));
    else if (reqStatus) where.overall_status = reqStatus;
  }

  if (q.partName) where.part_name = q.partName;
  if (q.partCategory === "HPDC") where.part_name = { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] };
  else if (q.partCategory === "OTHER") where.part_name = { [Op.or]: [null, ""] };
  if (q.dieName) where.part_id = { [Op.like]: `%-${q.dieName}-%` };
  if (q.category) where.rejection_category = q.category;

  // scanner misreads (several IDs in one read, fragments) are not parts — see VALID_SCAN_SQL
  and.push(sequelize.literal(require("../utils/productionDay").VALID_SCAN_SQL));
  if (!isGate || !gateTimeUsed) and.push(sequelize.literal(LATEST_ROW_SQL)); // the gate id list is already one row per part
  if (and.length) where[Op.and] = and;
  return { where, statusExpr, stationScope, leak };
}

// Final status of one part, same rule as the SQL above: NG if overall_status is NG, any station is NG,
// or the leak test result is NG (leak fails often keep overall_status IN_PROGRESS / PASSED).
const leakResultOf = (leakData) => {
  let ld = leakData;
  if (typeof ld === "string") { try { ld = JSON.parse(ld); } catch (e) { void e; return ""; } }
  if (Array.isArray(ld)) ld = ld[ld.length - 1];
  return String(ld?.result || ld?.Result || "").trim().toUpperCase();
};
const partStatusOf = (row) => {
  const st = (v) => String(v || "").trim().toUpperCase();
  if (["NG", "FAILED"].includes(st(row.overall_status))) return "NG";
  if (["op100", "op110", "op120", "op130", "op140", "op150", "op160"].some((op) => NG_VALUES.includes(st(row[op + "_status"])))) return "NG";
  if (NG_VALUES.includes(leakResultOf(row.leak_data))) return "NG";
  if (OK_VALUES.includes(st(row.overall_status))) return "PASSED";
  return row.overall_status ? st(row.overall_status) : "IN_PROGRESS";
};

const classifyStatus = (raw) => {
  const s = String(raw || "").trim().toUpperCase();
  if (OK_VALUES.includes(s)) return "OK";
  if (NG_VALUES.includes(s)) return "NG";
  return "IN_PROGRESS";
};

// Hide stations after the selected gate. Leak test is not in the logs, so for OP150 keep every station up to
// OP150 (OP100–OP140) and carry any leak readings from dropped logs onto the last kept log.
// Time the selected station handled each part (shown as "Station Scan Time"): its LATEST scan at that station in
// OperationLogs — the same time the filter uses (the raw_logs copy on the report row can lag behind the live logs) —
// or the leak result time for OP150. Returns Map(report.id → ISO string).
/* Rejection details of NG parts (category, reason, view, zone, sub zone).
   ProductionReports keeps no operator entry for most NG parts — the entry lives in Parts.interlock_reason as
   "Category: CR | View: Right Side | Zone: ZONE-N / Sub Zone N-2 | Reason: Dent". Sensor rejects with no entry get
   the same defaults as the Rejection Analysis records (leak test = CRAM, OP130 = CRAM, OP120/OP100 = CR, OP140 = MR). */
const readLabel = (text, label) => {
  const m = String(text || "").match(new RegExp(`${label}:\\s*([^|\\n]+)`, "i"));
  return m ? m[1].trim() : "";
};
const NG_TOKENS = new Set(["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]);
async function rejectionInfoFor(reports) {
  const out = new Map();
  const ngReports = reports.filter((rep) => partStatusOf(rep) === "NG");
  if (!ngReports.length) return out;
  const keys = [...new Set(ngReports.flatMap((rep) => [rep.part_id, rep.customer_qr]).filter((k) => k && k !== "-").map(String))];
  const entries = new Map();
  for (let i = 0; i < keys.length; i += 1000) {
    const rows = await sequelize.query(
      "SELECT part_id, interlock_reason FROM Parts WHERE part_id IN (:keys) AND interlock_reason LIKE '%Category:%'",
      { replacements: { keys: keys.slice(i, i + 1000) }, type: sequelize.QueryTypes.SELECT },
    ).catch(() => []);
    rows.forEach((x) => entries.set(String(x.part_id), x.interlock_reason));
  }
  ngReports.forEach((rep) => {
    const text = entries.get(String(rep.part_id)) || entries.get(String(rep.customer_qr)) || rep.ng_reason || "";
    const ng = (op) => NG_TOKENS.has(String(rep[`${op}_status`] || "").trim().toUpperCase());
    const leakNg = leakResultOf(rep.leak_data) === "NG" || ng("op150");
    const zoneRaw = readLabel(text, "Zone");
    const [zonePart, subPart] = zoneRaw.split("/").map((x) => x.trim());
    const info = {
      category: String(rep.rejection_category || "").trim() || readLabel(text, "Category"),
      reason: String(rep.rejection_reason || "").trim() || readLabel(text, "Reason"),
      view: readLabel(text, "View"),
      zone: zonePart || "",
      subZone: readLabel(text, "Sub Zone") || String(subPart || "").replace(/^sub\s*zone\s*/i, "").trim(),
    };
    // sensor rejects (no operator entry): defaults by the station that rejected the part
    if (!info.reason) {
      if (leakNg && !ng("op120") && !ng("op130") && !ng("op100")) Object.assign(info, { reason: "Pressure Leakage Fail (OP150)", view: info.view || "Leak Testing", zone: info.zone || "Leak Test" });
      else if (ng("op130")) info.reason = "Pre-Inspection Visual NG";
      else if (ng("op120")) info.reason = "Casting Visual NG";
      else if (ng("op140")) info.reason = "Auto Gauging Dimension NG";
      else if (ng("op100")) info.reason = "DCM Casting Defect";
    }
    if (!info.category) info.category = leakNg && !ng("op120") && !ng("op130") && !ng("op100") ? "CRAM" : ng("op130") ? "CRAM" : ng("op140") ? "MR" : "CR";
    // leak-test rejects are casting porosity found after machining → CRAM (same as Rejection Analysis)
    if (leakNg && !ng("op120") && !ng("op130") && !ng("op100")) info.category = "CRAM";
    out.set(rep.id, info);
  });
  return out;
}
const stampRejection = (rawLogs, info) => {
  if (!info) return;
  rawLogs.forEach((log) => {
    log.rejectionCategory = log.rejectionCategory || info.category;
    log.rejectionReason = log.rejectionReason || info.reason;
    log.rejectionView = log.rejectionView || info.view;
    log.rejectionZone = log.rejectionZone || info.zone;
    log.rejectionSubZone = log.rejectionSubZone || info.subZone;
  });
};

async function gateScanTimes(reports, stationScope, leak) {
  const out = new Map();
  if (!stationScope || !reports.length) return out;
  if (leak) {
    reports.forEach((rep) => { const t = leakTimeUtcOf(rep.leak_data); if (t) out.set(rep.id, t); });
    return out;
  }
  const keys = [...new Set(reports.flatMap((rep) => [rep.part_id, rep.customer_qr]).filter(Boolean).map(String))];
  if (!keys.length) return out;
  const latest = new Map();
  for (let i = 0; i < keys.length; i += 1000) {
    const rows = await sequelize.query(
      `SELECT part_id, MAX(createdAt) AS at FROM OperationLogs WHERE (operation_no = :op OR station_no = :op) AND part_id IN (:keys) GROUP BY part_id`,
      { replacements: { op: stationScope, keys: keys.slice(i, i + 1000) }, type: sequelize.QueryTypes.SELECT },
    );
    rows.forEach((x) => latest.set(String(x.part_id), new Date(x.at)));
  }
  reports.forEach((rep) => {
    const t = [latest.get(String(rep.part_id)), latest.get(String(rep.customer_qr))].filter(Boolean).sort((x, y) => x - y).pop();
    if (t) out.set(rep.id, t.toISOString());
  });
  return out;
}

function trimLogsToGate(rawLogs, stationScope, leak) {
  if (!stationScope) return rawLogs;
  const opOf = (log) => String(log.operationNo || log.stationNo || log.operation_no || log.station_no || "").trim().toUpperCase();
  let kept;
  if (leak) {
    kept = rawLogs.filter((log) => (parseInt(opOf(log).replace(/\D/g, ""), 10) || 0) <= 150);
    if (!kept.length) kept = rawLogs.slice(0, 1);
    const last = kept[kept.length - 1];
    rawLogs.forEach((log) => {
      if (kept.includes(log) || !last) return;
      ["leakTestReadings", "leakTestReading", "leak_data", "leakTest"].forEach((k) => {
        if (log[k] && !last[k]) last[k] = log[k];
      });
    });
    return kept;
  }
  let targetIndex = rawLogs.length - 1;
  for (let i = rawLogs.length - 1; i >= 0; i--) {
    const log = rawLogs[i];
    if (opOf(log) === stationScope || String(log.machine_id).toUpperCase() === stationScope || String(log.machineId).toUpperCase() === stationScope) {
      targetIndex = i;
      break;
    }
  }
  kept = rawLogs.slice(0, targetIndex + 1);
  if ((parseInt(stationScope.replace(/\D/g, ""), 10) || 0) < 150) {
    // gates before the leak test: leak readings would be from a later step
    kept.forEach((log) => { delete log.leakTestReadings; delete log.leakTestReading; delete log.leak_data; });
  }
  return kept;
}

// Row order. With a gate selected the table can be sorted by the station's own scan time (sortBy=gateScanAt,
// sortDir=asc|desc) — done in SQL so it is correct across pages, not just inside the visible page.
function historicalOrder(q, stationScope, leak) {
  const dir = String(q.sortDir || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  if (String(q.sortBy || "") === "gateScanAt" && stationScope) {
    const at = leak
      ? LEAK_TIME_UTC
      : `(SELECT MAX(o.createdAt) FROM OperationLogs o WHERE (o.part_id = [ProductionReport].[part_id] OR o.part_id = [ProductionReport].[customer_qr])
          AND (o.operation_no = ${sequelize.escape(stationScope)} OR o.station_no = ${sequelize.escape(stationScope)}))`;
    return [[sequelize.literal(at), dir], ["id", dir]];
  }
  return [["first_scan_at", "DESC"], ["id", "DESC"]];
}

exports.getHistoricalReportData = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(Number.parseInt(req.query.pageSize || req.query.limit, 10) || 1000, 10);
    const offset = (page - 1) * pageSize;

    // Filters (shared with the Excel export)
    const { where, statusExpr, stationScope, leak } = await buildHistoricalWhere(req.query || {});

    // 1. Fetch Paginated Rows
    const order = historicalOrder(req.query || {}, stationScope, leak);
    const { count, rows } = await ProductionReport.findAndCountAll({
      where,
      limit: pageSize,
      offset: offset,
      order,
      raw: true,
    });

    // 2. Metrics — grouped by the selected gate's status (station column, leak result) or the part status
    const statusLiteral = ProductionReport.sequelize.literal(statusExpr);
    const isStationGate = Boolean(stationScope) && !leak;
    const metricsResult = isStationGate
      ? Object.entries((await ProductionReport.findAll({ where, attributes: [[statusLiteral, "overall_status"]], raw: true }))
        .reduce((acc, r) => { const k = r.overall_status || ""; acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
        .map(([overall_status, count]) => ({ overall_status, count }))
      : await ProductionReport.findAll({
        where,
        attributes: [
          [statusLiteral, 'overall_status'],
          [ProductionReport.sequelize.fn('COUNT', ProductionReport.sequelize.col('id')), 'count']
        ],
        group: [statusLiteral],
        raw: true,
      });

    const { getPlcReadingColumns } = require("../services/report/reportExportService");
    const plcColumnSet = await getPlcReadingColumns();

    let totalProduction = 0;
    let totalOK = 0;
    let totalNG = 0;
    let inProgress = 0;

    metricsResult.forEach(row => {
      const cnt = Number(row.count) || 0;
      const cls = classifyStatus(row.overall_status);
      if (cls === 'OK') totalOK += cnt;
      else if (cls === 'NG') totalNG += cnt;
      else inProgress += cnt;
    });
    // Every part in the filtered set is counted once: produced = OK + NG + in process
    totalProduction = totalOK + totalNG + inProgress;

    // Overall (no gate): one set of parts — those first scanned in the period — so Total = OK + NG + In progress
    // and the table rows match the cards. The final station's own output is the OP160 gate view.

    // Pass rate over completed parts only (OK + NG); parts still in process are excluded
    const passRate = (totalOK + totalNG) > 0 ? Number(((totalOK / (totalOK + totalNG)) * 100).toFixed(2)) : 0;

    // 3. Format rows back exactly as the UI expects (array of OperationLog arrays)
    // The Master Table stored the raw OperationLog entries array in `raw_logs` for this part.
    // The UI's `paginateReportRowsByPart` grouping logic expects an array of these raw OperationLog entries.
    // So we just flatten the `raw_logs` array of arrays into a single array of raw logs, 
    // exactly like `getLegacyReportBundle` would return!
    const gateTimes = await gateScanTimes(rows, stationScope, leak);
    const rejInfo = await rejectionInfoFor(rows);
    const formattedRows = rows.flatMap(row => {
      let rawLogs = row.raw_logs ? (typeof row.raw_logs === 'string' ? JSON.parse(row.raw_logs) : row.raw_logs) : [];

      // Stamp every log entry with ProductionReport master metadata so the frontend
      // can correctly resolve final status and final date without re-calculating.
      const masterOverallStatus = partStatusOf(row);
      const masterFinalScanAt = row.final_scan_at ? new Date(row.final_scan_at).toISOString() : null;
      const masterFirstScanAt = row.first_scan_at ? new Date(row.first_scan_at).toISOString() : null;

      rawLogs = rawLogs.map(log => ({
        ...log,
        __pr_overall_status: masterOverallStatus,
        __pr_final_scan_at: masterFinalScanAt,
        __pr_first_scan_at: masterFirstScanAt,
      }));

      // Sort logs chronologically to ensure trimming works correctly
      rawLogs.sort((a, b) => {
        const tA = new Date(a.createdAt || a.plc_end_time || 0).getTime();
        const tB = new Date(b.createdAt || b.plc_end_time || 0).getTime();
        return tA - tB;
      });

      // Trim data table: if a quality gate is selected, hide all stations that occurred AFTER it
      const gateScanAt = gateTimes.get(row.id);
      rawLogs = trimLogsToGate(rawLogs, stationScope, leak);
      if (gateScanAt) rawLogs.forEach((log) => { log.__pr_gate_scan_at = gateScanAt; });
      stampRejection(rawLogs, rejInfo.get(row.id));

      // Clean up legacy duplicate leak test structures to prevent showing double in Postman
      rawLogs.forEach(log => {
        if (log.leakTestReadings && log.leakTestReading) {
          delete log.leakTestReading; // We only need the array version
        }
      });
      return rawLogs;
    });

    const payload = {
      rows: formattedRows,
      metrics: {
        totalProduction,
        totalOK,
        totalNG,
        passed: totalOK, // keeping for backward compatibility
        failed: totalNG,
        inProgress,
        passRate,
        shotSummary: { totalShots: 0, okShots: 0, warmUpShots: 0, ngShots: 0 }
      },
      pagination: {
        page,
        pageSize,
        totalRows: count,
        totalPages: Math.ceil(count / pageSize),
        hasNextPage: (page * pageSize) < count,
        hasPrevPage: page > 1,
      },
      plcColumns: [...plcColumnSet],
      reportMode: "HISTORICAL_MASTER",
      gateScope: stationScope ? { station: stationScope, leakMachineId: leak?.machineId ?? null, leakMachineName: leak?.machineName || null } : null,
      warning: undefined,
    };

    if (reportPrivate?.wantsCleanReportResponse && reportPrivate.wantsCleanReportResponse(req.query || {})) {
      res.json(reportPrivate.formatCleanReportResponse(payload));
    } else {
      res.json(payload);
    }
  } catch (error) {
    console.error("[HistoricalReport] Error fetching historical report:", error);
    res.status(500).json({ error: error.message });
  }
};

const { syncDateRange } = require("../services/report/historicalSyncService");

exports.syncHistoricalData = async (req, res) => {
  try {
    let dateFrom, dateTo;
    if (req.body.dateFrom && req.body.dateTo) {
      dateFrom = new Date(req.body.dateFrom);
      dateTo = new Date(req.body.dateTo);
    } else {
      dateTo = new Date();
      dateFrom = new Date(dateTo.getTime() - 24 * 60 * 60 * 1000); // 24 hours back
    }

    // Kick off sync asynchronously so we don't block the request if it takes a while
    syncDateRange(dateFrom, dateTo).catch(err => {
      console.error("[HistoricalReport] Manual sync error:", err);
    });

    res.json({ message: "Sync started in the background", dateFrom, dateTo });
  } catch (error) {
    console.error("[HistoricalReport] Error triggering sync:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.exportHistoricalReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = {}, type = "full" } = req.body || {};
    req.setTimeout?.(10 * 60 * 1000);
    res.setTimeout?.(10 * 60 * 1000);

    const { Op } = require("sequelize");
    const ProductionReport = require("../models/ProductionReport");
    const { buildStationPairsFromRows } = require("../services/report/stationPairBuilder");
    const { calculateProductionMetrics } = require("../services/report/reportMetricsService");
    const { generateIndustrialExcel } = require("../services/report/excelTemplateEngine");

    // Same filters as the page (shared builder)
    const { where, stationScope, leak } = await buildHistoricalWhere(filters || {});

    const rows = [];
    const BATCH_SIZE = 500;
    let offset = 0;

    while (true) {
      const reportsChunk = await ProductionReport.findAll({
        where,
        order: [["first_scan_at", "DESC"], ["id", "DESC"]],
        raw: true,
        limit: BATCH_SIZE,
        offset: offset
      });

      if (!reportsChunk || reportsChunk.length === 0) {
        break;
      }

      const gateTimes = await gateScanTimes(reportsChunk, stationScope, leak);
      const rejInfo = await rejectionInfoFor(reportsChunk);
      for (const report of reportsChunk) {
        let rawLogs = report.raw_logs;
        if (typeof rawLogs === 'string') {
          try { rawLogs = JSON.parse(rawLogs); } catch (e) { rawLogs = []; }
        }
        if (Array.isArray(rawLogs)) {
          // Sort logs chronologically to ensure trimming works correctly
          rawLogs.sort((a, b) => {
            const tA = new Date(a.createdAt || a.plc_end_time || 0).getTime();
            const tB = new Date(b.createdAt || b.plc_end_time || 0).getTime();
            return tA - tB;
          });

          // Trim data table: if a quality gate is selected, hide all stations that occurred AFTER it
          const gateScanAt = gateTimes.get(report.id);
          rawLogs = trimLogsToGate(rawLogs, stationScope, leak);
          if (gateScanAt) rawLogs.forEach((log) => { log.__pr_gate_scan_at = gateScanAt; });
          stampRejection(rawLogs, rejInfo.get(report.id));

          // Stamp raw logs with master metadata for Excel engine
          const masterOverallStatus = partStatusOf(report);
          const masterFinalScanAt = report.final_scan_at ? new Date(report.final_scan_at).toISOString() : null;
          const masterFirstScanAt = report.first_scan_at ? new Date(report.first_scan_at).toISOString() : null;
          rawLogs.forEach(log => {
            log.__pr_overall_status = masterOverallStatus;
            log.__pr_final_scan_at = masterFinalScanAt;
            log.__pr_first_scan_at = masterFirstScanAt;
          });
          rows.push(...rawLogs);
        }
      }

      offset += BATCH_SIZE;
      
      // Yield to the event loop to prevent blocking the Node.js thread during heavy processing
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const stationPairs = await buildStationPairsFromRows(rows, filters);
    const metrics = calculateProductionMetrics(rows, filters);

    await generateIndustrialExcel(res, {
      rows,
      stationPairs,
      metrics,
      filters,
      reportConfig,
      sheetName: type === "ng" ? "Historical NG Report" : "Historical Production",
      filePrefix: type === "ng" ? "HISTORICAL_NG_REPORT" : "HISTORICAL_FULL_REPORT"
    });
  } catch (error) {
    console.error("[HistoricalReport] Excel export error:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
};
