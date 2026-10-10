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
const { productionWindow, shiftCaseSql, shiftCodeAt, PLANT_OFFSET_MIN } = require("../utils/productionDay");
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

// Active shift definitions (shift filter, and the shift of a gate scan shown in the gate view) — cached 1 min
let shiftDefsCache = { at: 0, list: null };
async function activeShiftDefs() {
  if (shiftDefsCache.list && Date.now() - shiftDefsCache.at < 60 * 1000) return shiftDefsCache.list;
  const list = await sequelize.query("SELECT shift_code, start_time, end_time FROM Shifts WHERE is_active = 1", { type: sequelize.QueryTypes.SELECT });
  shiftDefsCache = { at: Date.now(), list };
  return list;
}

// Gate, date window and shift definitions of a filter — resolved once and shared by the where builder and the
// gate-set loader below.
async function historicalFilterContext(q = {}) {
  const { stationScope, leak } = await resolveGateScope(q.machineId || q.operationNo || q.stationNo || q.station);
  const win = q.dateFrom && q.dateTo ? productionWindow({ dateFrom: q.dateFrom, dateTo: q.dateTo }) : null;
  const shiftDefs = q.shiftCode || stationScope ? await activeShiftDefs() : [];
  return { stationScope, leak, win, shiftDefs };
}
// Shift code of a gate scan time (ISO string / Date) — "" when unknown
const gateShiftOf = (at, shiftDefs) => (at ? String(shiftCodeAt(new Date(at), shiftDefs || []) || "") : "");

/**
 * opts.ctx       — a historicalFilterContext() result (resolved here when missing)
 * opts.gateKeys  — gate filter: the part IDs already found in the scan log (loadGateSet). They replace the
 *                  OperationLogs sub-query, and the station status filter is then applied by the caller.
 */
async function buildHistoricalWhere(q = {}, opts = {}) {
  const ctx = opts.ctx || await historicalFilterContext(q);
  const { stationScope, leak, win, shiftDefs } = ctx;
  const gateKeys = Array.isArray(opts.gateKeys) ? opts.gateKeys : null;
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
    // (with gateKeys the same part list was already worked out from one read of the station's scans)
    const sub = gateKeys
      ? `SELECT part_id FROM OPENJSON(${esc(JSON.stringify(gateKeys))}) WITH (part_id nvarchar(255) '$')`
      : `SELECT part_id FROM OperationLogs WHERE (operation_no = ${esc(stationScope)} OR station_no = ${esc(stationScope)}) AND LEN(part_id) >= 7 AND UPPER(result) IN ('OK', 'NG')${since} GROUP BY part_id${gateTime ? ` HAVING ${gateTime}` : ""}`;
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
    if (gateKeys) { /* status filter applied by loadGateSet from the same scan read */ }
    else if (wantOk) and.push(sequelize.literal(`${statusExpr} = 'OK'`));
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
  return { where, statusExpr, stationScope, leak, ctx, gateTimeUsed, want: { ok: wantOk, ng: wantNg, wip: wantWip } };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Quality-gate set — worked out ONCE per request.

   The gate filter used to be one SQL where clause that SQL Server evaluated again for the count, the page, the
   metrics (with a correlated "latest result" sub-query per row) and the scan times: 4–14 s for one day, minutes
   when the database was busy. Now:
   1. ONE read of the station's scans since the window start (part_id, result, time) — small, index range on time;
   2. in memory: each part's latest OK / NG scan → the parts whose decisive scan falls in the window / shift
      (exactly the old HAVING MAX(createdAt) rule), plus each part's station result and scan time;
   3. ONE query for the matching report rows (id, first_scan_at), with the other filters (search, part, die …);
   4. status filter, totals, OK / NG and the sort by station scan time are done on that list; only the requested
      page of full rows is read afterwards.
   Same results as the old per-row SQL (scripted comparison old vs new: totals, metrics and pages identical).
   Why reading from the window start is enough for the result / time: every part in the set has an OK / NG scan
   inside the window, so its latest scan at the station (by part ID or customer QR) is at or after the window start.
   ═══════════════════════════════════════════════════════════════════════════ */
// SQL Server compares these IDs case-insensitively and ignores trailing spaces — the in-memory maps do the same
const gateKeyOf = (v) => (v === null || v === undefined ? null : String(v).toUpperCase().replace(/\s+$/, ""));
const laterScan = (a, b) => (!a ? b : !b ? a : (b.at > a.at || (b.at === a.at && b.id > a.id)) ? b : a);

/* ═══════════════════════════════════════════════════════════════════════════
   In progress at a gate ("waiting for OP130").

   A part is in progress at the selected gate when
   1. it PASSED THE PREVIOUS GATE inside the window (and shift, when one is selected):
      - previous gate = the operation with the next lower Machines.sequence_no (OP110 → OP100, OP130 → OP120 …);
        the gate's "passed" scan is the part's latest OK / NG scan there inside the window, and it must be OK;
      - leak test (OP150, any leak machine): previous gate = OP140;
      - OP160: previous gate = the leak test — leak result OK with its result time inside the window; a part with
        NO leak result at all falls back to an OK at OP140 inside the window (some parts are not leak tested);
   2. and it has NO result at the selected gate up to the window end (the window end is "now" for today):
      - station gate: no OK / NG scan at that station before the window end (BLOCK re-scans do not count);
      - leak test: no leak result, or a leak result time after the window end.
   OP100 has no previous gate → no "in progress" (null). The three leak machines share one waiting queue (a part
   is not assigned to a leak machine before it is tested), so each leak machine shows the same list as OP150.
   One row per part (newest report row), the other filters (search, part, die …) applied as for OK / NG.
   ═══════════════════════════════════════════════════════════════════════════ */
let gateSequenceCache = { at: 0, list: null };
async function gateSequence() {
  if (gateSequenceCache.list && Date.now() - gateSequenceCache.at < 5 * 60 * 1000) return gateSequenceCache.list;
  const rows = await sequelize.query(
    "SELECT UPPER(LTRIM(RTRIM(operation_no))) AS op, MIN(sequence_no) AS seq FROM Machines WHERE operation_no IS NOT NULL AND operation_no <> '' GROUP BY UPPER(LTRIM(RTRIM(operation_no)))",
    { type: sequelize.QueryTypes.SELECT },
  );
  const list = rows.map((r) => ({ op: r.op, seq: Number(r.seq) })).filter((r) => r.op && Number.isFinite(r.seq)).sort((a, b) => a.seq - b.seq);
  gateSequenceCache = { at: Date.now(), list };
  return list;
}
async function previousGateOf(stationScope) {
  const st = String(stationScope || "").toUpperCase();
  if (st === "OP150") return "OP140";
  const list = await gateSequence();
  const cur = list.find((r) => r.op === st);
  if (!cur) return null;
  const before = list.filter((r) => r.seq < cur.seq);
  return before.length ? before[before.length - 1].op : null;
}

// part key → time (ms) of its OK at `op`: latest OK / NG scan inside the window is OK (and in the shift)
async function passedAtStation(op, win, shiftFilter, shiftDefs) {
  const logs = await sequelize.query(
    `SELECT part_id, result, createdAt, id FROM OperationLogs
      WHERE (operation_no = :st OR station_no = :st) AND createdAt >= :from AND createdAt < :to`,
    { replacements: { st: op, from: win.from.toISOString(), to: win.to.toISOString() }, type: sequelize.QueryTypes.SELECT },
  );
  const decisive = new Map();
  for (const log of logs) {
    const key = gateKeyOf(log.part_id);
    if (key === null || key.length < 7) continue;
    const result = String(log.result || "").toUpperCase().replace(/\s+$/, "");
    if (result !== "OK" && result !== "NG") continue;
    decisive.set(key, laterScan(decisive.get(key), { at: new Date(log.createdAt).getTime(), id: log.id, result }));
  }
  const out = new Map();
  for (const [key, scan] of decisive) {
    if (scan.result !== "OK") continue;
    if (shiftFilter && String(shiftCodeAt(new Date(scan.at), shiftDefs) || "").toUpperCase() !== shiftFilter) continue;
    out.set(key, scan.at);
  }
  return out;
}

async function loadGateWip(q = {}, ctx, { order = "default" } = {}) {
  const { stationScope, leak, win, shiftDefs } = ctx;
  if (!stationScope || !win) return null;
  const previous = await previousGateOf(leak ? "OP150" : stationScope);
  if (!previous) return null;
  const t0 = Date.now();
  const shiftFilter = q.shiftCode && shiftDefs.length ? String(q.shiftCode).trim().toUpperCase() : null;
  const fromMs = win.from.getTime();
  const toMs = win.to.getTime();
  const inShift = (ms) => !shiftFilter || String(shiftCodeAt(new Date(ms), shiftDefs) || "").toUpperCase() === shiftFilter;
  const viaLeak = previous === "OP150"; // OP160: leak result first, OP140 for parts with no leak result

  // 1. parts that passed the previous gate in the window
  const prevOk = await passedAtStation(viaLeak ? "OP140" : previous, win, shiftFilter, shiftDefs);
  const keys = new Set(prevOk.keys());
  if (viaLeak) {
    // updatedAt bound: the row is rewritten when its leak result is synced (after the test), so a result in the
    // window means updatedAt >= window start; one day of margin for leak-machine clock drift. Skips parsing the
    // JSON of every report (1.0–1.4 s → 0.15–0.3 s; same rows for 10-01…10-09).
    const leakOk = await sequelize.query(
      `SELECT part_id FROM ProductionReports
        WHERE updatedAt >= DATEADD(DAY, -1, :from)
          AND ${LEAK_RESULT} IN (${sqlList(OK_VALUES)}) AND ${LEAK_TIME_UTC} >= :from AND ${LEAK_TIME_UTC} < :to`,
      { replacements: { from: win.from.toISOString(), to: win.to.toISOString() }, type: sequelize.QueryTypes.SELECT },
    );
    leakOk.forEach((r) => { const k = gateKeyOf(r.part_id); if (k && k.length >= 7) keys.add(k); });
  }
  if (!keys.size) return { rows: [], previous, viaLeak };

  // 2. their newest report rows, with the page's other filters
  const { where } = await buildHistoricalWhere({ ...q, status: "" }, { ctx: { ...ctx, stationScope: previous, leak: null }, gateKeys: [...keys] });
  const reports = await ProductionReport.findAll({
    where,
    attributes: ["id", "part_id", "customer_qr", "first_scan_at",
      [sequelize.literal(LEAK_RESULT), "leak_result"], [sequelize.literal(LEAK_TIME_UTC), "leak_at"]],
    raw: true,
  });

  // 3. passed the previous gate (per row), not yet tested at the selected gate
  const candidates = [];
  for (const rep of reports) {
    const rowKeys = [gateKeyOf(rep.part_id), gateKeyOf(rep.customer_qr)].filter((k) => k !== null);
    const leakResult = classifyStatus(rep.leak_result);
    const hasLeak = Boolean(rep.leak_result);
    const leakAt = rep.leak_at ? new Date(rep.leak_at).getTime() : null;
    let prevAt = null;
    if (viaLeak && hasLeak) {
      if (leakResult === "OK" && leakAt !== null && leakAt >= fromMs && leakAt < toMs && inShift(leakAt)) prevAt = leakAt;
    } else {
      prevAt = rowKeys.reduce((m, k) => (prevOk.has(k) ? Math.max(m ?? -Infinity, prevOk.get(k)) : m), null);
    }
    if (prevAt === null) continue;
    if (leak && hasLeak && (leakAt === null || leakAt < toMs)) continue; // already leak tested
    candidates.push({ rep, rowKeys, prevAt });
  }
  let tested = new Set();
  if (!leak && candidates.length) {
    const allKeys = [...new Set(candidates.flatMap((c) => c.rowKeys))];
    const hits = await sequelize.query(
      `SELECT DISTINCT o.part_id FROM OperationLogs o
        JOIN OPENJSON(:keys) WITH (k nvarchar(255) '$') j ON o.part_id = j.k
        WHERE (o.operation_no = :st OR o.station_no = :st) AND UPPER(o.result) IN ('OK', 'NG') AND o.createdAt < :to`,
      { replacements: { keys: JSON.stringify(allKeys), st: stationScope, to: win.to.toISOString() }, type: sequelize.QueryTypes.SELECT },
    );
    tested = new Set(hits.map((h) => gateKeyOf(h.part_id)));
  }
  const rows = candidates
    .filter((c) => !c.rowKeys.some((k) => tested.has(k)))
    .map((c) => ({ id: c.rep.id, status: "IN_PROGRESS", sortAt: c.prevAt, scanAt: null, prevAt: new Date(c.prevAt).toISOString() }));
  const sign = order === "asc" ? 1 : -1; // default: latest passed first
  rows.sort((a, b) => sign * ((a.sortAt - b.sortAt) || (a.id - b.id)));
  if (process.env.HIST_TIMING) console.log(`[HistoricalReport] wip ${leak ? "OP150" : stationScope} (after ${previous}): ${keys.size} passed, ${rows.length} waiting, ${Date.now() - t0} ms`);
  return { rows, previous, viaLeak };
}

async function loadGateSet(q = {}, { ctx: givenCtx, order = "default" } = {}) {
  const ctx = givenCtx || await historicalFilterContext(q);
  const { stationScope, leak, win, shiftDefs } = ctx;
  if (!stationScope || !win) return null;
  // status WIP at a gate: the parts waiting for it (see loadGateWip) — station gates and the leak test
  const reqStatus = String(q.status || "").trim().toUpperCase();
  if (reqStatus === "WIP" || reqStatus === "IN_PROGRESS") {
    const wip = await loadGateWip(q, ctx, { order });
    const rows = wip ? wip.rows : [];
    return { rows, counts: { OK: 0, NG: 0, IN_PROGRESS: rows.length }, stationScope, leak, wip: wip ? { count: rows.length, previous: wip.previous, viaLeak: wip.viaLeak } : null };
  }
  // only station gates with a date window (always the case from the page / export); anything else → old path
  if (leak) return null;
  const shiftFilter = q.shiftCode && shiftDefs.length ? String(q.shiftCode).trim().toUpperCase() : null;
  const fromMs = win.from.getTime();
  const toMs = win.to.getTime();
  const t0 = Date.now();

  // 1. the station's scans since the window start
  const logs = await sequelize.query(
    `SELECT part_id, result, createdAt, id FROM OperationLogs
      WHERE (operation_no = :st OR station_no = :st) AND createdAt >= :from`,
    { replacements: { st: stationScope, from: win.from.toISOString() }, type: sequelize.QueryTypes.SELECT },
  );
  const t1 = Date.now();

  // 2. per part ID: latest OK / NG scan (decides the window and the result) and latest scan of any kind (time)
  const decisive = new Map(); // key → { at, id, result }
  const lastAny = new Map(); // key → ms
  for (const log of logs) {
    const key = gateKeyOf(log.part_id);
    if (key === null) continue;
    const at = new Date(log.createdAt).getTime();
    if (!(lastAny.get(key) >= at)) lastAny.set(key, at);
    const result = String(log.result || "").toUpperCase().replace(/\s+$/, "");
    if (result !== "OK" && result !== "NG") continue;
    decisive.set(key, laterScan(decisive.get(key), { at, id: log.id, result }));
  }
  // parts whose decisive scan is inside the window / shift (placeholder IDs shorter than 7 characters are not parts)
  const gateKeys = [];
  for (const [key, scan] of decisive) {
    if (key.length < 7) continue;
    if (!(scan.at >= fromMs && scan.at < toMs)) continue;
    if (shiftFilter && String(shiftCodeAt(new Date(scan.at), shiftDefs) || "").toUpperCase() !== shiftFilter) continue;
    gateKeys.push(key);
  }

  // 3. the matching report rows (newest row per part, other filters applied in SQL)
  const { where, want } = await buildHistoricalWhere(q, { ctx, gateKeys });
  const reports = gateKeys.length ? await ProductionReport.findAll({
    where,
    attributes: ["id", "part_id", "customer_qr"],
    order: [["first_scan_at", "DESC"], ["id", "DESC"]],
    raw: true,
  }) : [];
  const t2 = Date.now();

  // 4. station result + scan time per row, status filter, totals, order
  const rows = [];
  const counts = { OK: 0, NG: 0, IN_PROGRESS: 0 };
  for (const rep of reports) {
    const keys = [gateKeyOf(rep.part_id), gateKeyOf(rep.customer_qr)].filter((k) => k !== null);
    const scan = keys.reduce((acc, k) => laterScan(acc, decisive.get(k)), null);
    const status = scan ? scan.result : null;
    if (want.ok && status !== "OK") continue;
    if (want.ng && status !== "NG") continue;
    if (want.wip) continue;
    const anyAt = keys.reduce((m, k) => Math.max(m, lastAny.get(k) ?? -Infinity), -Infinity);
    // the "Station Scan Time" column skips empty IDs (as before); for an existing row both give the same time
    const shownAt = keys.filter(Boolean).reduce((m, k) => Math.max(m, lastAny.get(k) ?? -Infinity), -Infinity);
    rows.push({ id: rep.id, status, sortAt: anyAt, scanAt: Number.isFinite(shownAt) ? new Date(shownAt).toISOString() : null });
    counts[classifyStatus(status)] += 1;
  }
  if (order === "asc" || order === "desc") {
    const sign = order === "asc" ? 1 : -1;
    // SQL Server order: NULL first ascending, last descending; ties by id in the same direction
    rows.sort((a, b) => sign * ((a.sortAt - b.sortAt) || (a.id - b.id)));
  }
  if (process.env.HIST_TIMING) console.log(`[HistoricalReport] gate ${stationScope}: ${logs.length} scans ${t1 - t0} ms, ${reports.length} rows ${t2 - t1} ms, total ${Date.now() - t0} ms`);
  return { rows, counts, stationScope, leak };
}

// Final status of one part, same rule as the SQL above: NG if overall_status is NG, any station is NG,
// or the leak test result is NG (leak fails often keep overall_status IN_PROGRESS / PASSED).
const leakResultOf = (leakData) => {
  let ld = leakData;
  if (typeof ld === "string") { try { ld = JSON.parse(ld); } catch (e) { void e; return ""; } }
  if (Array.isArray(ld)) ld = ld[ld.length - 1];
  return String(ld?.result || ld?.Result || "").trim().toUpperCase();
};
// Exactly the PART_STATUS SQL (so every row's final status is what the OK / NG / In progress figures count):
// "OK" | "NG" | "IN_PROGRESS". The leak result is read like JSON_VALUE(leak_data, '$.result') (top-level object).
const sqlLeakResultOf = (leakData) => {
  let ld = leakData;
  if (typeof ld === "string") { try { ld = JSON.parse(ld); } catch (e) { void e; return ""; } }
  return ld && typeof ld === "object" && !Array.isArray(ld) ? String(ld.result ?? "").trim().toUpperCase() : "";
};
const partStatusOf = (row) => {
  const st = (v) => String(v || "").trim().toUpperCase();
  if (["NG", "FAILED"].includes(st(row.overall_status))) return "NG";
  if (["op100", "op110", "op120", "op130", "op140", "op150", "op160"].some((op) => NG_VALUES.includes(st(row[op + "_status"])))) return "NG";
  if (NG_VALUES.includes(sqlLeakResultOf(row.leak_data))) return "NG";
  if (OK_VALUES.includes(st(row.overall_status))) return "OK";
  return "IN_PROGRESS";
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
const { ngCategoryOf, emptySplit } = require("../utils/rejectionCategory");
// Operator entries (Parts.interlock_reason "Category: … | Reason: …") of the given part IDs / customer QRs
async function partsEntriesFor(reports) {
  const keys = [...new Set(reports.flatMap((rep) => [rep.part_id, rep.customer_qr]).filter((k) => k && k !== "-").map(String))];
  const entries = new Map();
  for (let i = 0; i < keys.length; i += 1000) {
    const rows = await sequelize.query(
      "SELECT part_id, interlock_reason FROM Parts WHERE part_id IN (:keys) AND interlock_reason LIKE '%Category:%'",
      { replacements: { keys: keys.slice(i, i + 1000) }, type: sequelize.QueryTypes.SELECT },
    ).catch(() => []);
    rows.forEach((x) => entries.set(String(x.part_id), x.interlock_reason));
  }
  return entries;
}
const entryOf = (entries, rep) => entries.get(String(rep.part_id)) || entries.get(String(rep.customer_qr)) || "";
// gate view: the selected gate the NG belongs to ("OP130", "OP150" for the leak machines); "" = overall view
const categoryGateHint = (stationScope, leak) => (leak ? "OP150" : (stationScope || ""));

/* CR / MR / CRAM split of the NG parts of the WHOLE filtered set (not just the page), same category rule as the
   rows' Category column and Rejection Analysis (utils/rejectionCategory). Only the NG rows' short columns are read
   (by id list, or by the filter with status NG) — one query + one Parts lookup, no per-row queries. */
const NG_SPLIT_ATTRS = ["id", "part_id", "customer_qr", "rejection_category", "rejection_reason", "ng_reason", "machine_name",
  "op100_status", "op110_status", "op120_status", "op130_status", "op140_status", "op150_status", "op160_status", "leak_data"];
async function ngCategorySplit({ ids = null, where = null, gateHint = "" }) {
  const t0 = Date.now();
  const split = emptySplit();
  let reports = [];
  if (Array.isArray(ids)) {
    for (let i = 0; i < ids.length; i += 2000) {
      reports = reports.concat(await ProductionReport.findAll({ where: { id: { [Op.in]: ids.slice(i, i + 2000) } }, attributes: NG_SPLIT_ATTRS, raw: true }));
    }
  } else if (where) {
    reports = await ProductionReport.findAll({ where, attributes: NG_SPLIT_ATTRS, raw: true });
  }
  if (!reports.length) return split;
  const entries = await partsEntriesFor(reports);
  reports.forEach((rep) => { split[ngCategoryOf(rep, entryOf(entries, rep), gateHint).category] += 1; });
  if (process.env.HIST_TIMING) console.log(`[HistoricalReport] NG split ${gateHint || "overall"}: ${reports.length} NG rows, ${Date.now() - t0} ms`);
  return split;
}

async function rejectionInfoFor(reports, gateHint = "") {
  const out = new Map();
  const ngReports = reports.filter((rep) => partStatusOf(rep) === "NG");
  if (!ngReports.length) return out;
  const entries = await partsEntriesFor(ngReports);
  ngReports.forEach((rep) => {
    const text = entryOf(entries, rep) || rep.ng_reason || "";
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
    // category: the Rejection Analysis rule (utils/rejectionCategory) — the NG card's CR / MR / CRAM split counts the same
    info.category = ngCategoryOf(rep, entryOf(entries, rep), gateHint).category;
    out.set(rep.id, info);
  });
  return out;
}
const stampRejection = (rawLogs, info) => {
  if (!info) return;
  rawLogs.forEach((log) => {
    log.rejectionCategory = info.category || log.rejectionCategory; // CR / MR / CRAM, as counted in the NG split
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

/**
 * The figures of the page cards AND of the Excel summary block — one implementation for both.
 *   gateSet           — loadGateSet() result (station gate with a date window) or null
 *   where, statusExpr — buildHistoricalWhere() result when there is no gate set
 *   wipPromise        — loadGateWip() promise (gate view without a status filter) or null
 * → { metrics: { totalProduction, totalOK, totalNG, inProgress, passRate, ngCategories: { CR, MR, CRAM }, … }, gateWip }
 * Overall view: Total = OK + NG + In progress (every part first scanned in the period, counted once).
 * Gate view: Total = parts inspected at the gate (OK + NG); In progress = parts waiting for the gate (not in Total).
 */
async function historicalSummary({ q = {}, ctx, gateSet = null, where = null, statusExpr = null, wipPromise = null }) {
  const { stationScope, leak } = ctx;
  const gateHint = categoryGateHint(stationScope, leak);
  let metricsResult;
  let ngSplitPromise;
  if (gateSet) {
    metricsResult = Object.entries(gateSet.counts).map(([overall_status, n]) => ({ overall_status, count: n }));
    const ngIds = gateSet.rows.filter((r) => classifyStatus(r.status) === "NG").map((r) => r.id);
    ngSplitPromise = ngCategorySplit({ ids: ngIds, gateHint });
  } else {
    const statusLiteral = sequelize.literal(statusExpr);
    const isStationGate = Boolean(stationScope) && !leak;
    const reqStatus = String(q.status || "").trim().toUpperCase();
    const onlyNonNg = ["OK", "PASSED", "WIP", "IN_PROGRESS"].includes(reqStatus);
    // NG rows of the same filter (status NG): their CR / MR / CRAM split
    ngSplitPromise = onlyNonNg
      ? Promise.resolve(emptySplit())
      : buildHistoricalWhere({ ...q, status: "NG" }, { ctx }).then(({ where: ngWhere }) => ngCategorySplit({ where: ngWhere, gateHint }));
    ngSplitPromise.catch(() => {}); // awaited below
    metricsResult = await (isStationGate
      ? ProductionReport.findAll({ where, attributes: [[statusLiteral, "overall_status"]], raw: true })
        .then((list) => Object.entries(list.reduce((acc, r) => { const k = r.overall_status || ""; acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
          .map(([overall_status, n]) => ({ overall_status, count: n })))
      : ProductionReport.findAll({
        where,
        attributes: [[statusLiteral, "overall_status"], [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
        group: [statusLiteral],
        raw: true,
      }));
  }

  let totalOK = 0;
  let totalNG = 0;
  let inProgress = 0;
  metricsResult.forEach((row) => {
    const cnt = Number(row.count) || 0;
    const cls = classifyStatus(row.overall_status);
    if (cls === "OK") totalOK += cnt;
    else if (cls === "NG") totalNG += cnt;
    else inProgress += cnt;
  });
  // Every part in the filtered set is counted once: produced = OK + NG + in process
  let totalProduction = totalOK + totalNG + inProgress;
  // Gate view: Total = parts inspected at the gate (OK + NG); "in progress" = parts waiting for the gate
  // (passed the previous gate in the period, no result here yet — see loadGateWip), shown on its own.
  let gateWip = null;
  if (stationScope) {
    if (gateSet?.wip !== undefined) {
      gateWip = gateSet.wip;
      inProgress = gateSet.wip ? gateSet.wip.count : 0;
    } else if (wipPromise) {
      const wip = await wipPromise;
      gateWip = wip ? { count: wip.rows.length, previous: wip.previous, viaLeak: wip.viaLeak } : null;
      inProgress = gateWip ? gateWip.count : 0;
    } else {
      inProgress = 0; // OK / NG filter: the figures describe the filtered parts only
    }
    totalProduction = totalOK + totalNG;
  }
  // Overall view, same rule as the Dashboard: Total = parts cast in the period, OK = parts that passed Final Inspection
  // (OP160) in the period — also parts cast earlier — NG = rejected parts, In progress = the rest. Counting OK only for
  // parts cast AND finished in the period gave e.g. 133 OK for a day the line passed 324 at Final.
  const plainOverall = !stationScope && ctx.win && !q.status && !q.query && !q.barcode && !q.partId && !q.customerCode
    && !q.category && !q.partCategory && !q.dieName && !q.user;
  if (plainOverall) {
    try {
      const shiftSql = q.shiftCode && ctx.shiftDefs?.length ? ` AND ${shiftCaseSql("createdAt", ctx.shiftDefs)} = :shift` : "";
      const [r] = await sequelize.query(`
        SELECT COUNT(*) AS ok FROM (
          SELECT UPPER(result) AS r, createdAt,
                 ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY createdAt DESC, id DESC) AS rn
            FROM OperationLogs
           WHERE (operation_no = 'OP160' OR station_no = 'OP160') AND UPPER(result) IN ('OK', 'NG') AND LEN(part_id) >= 7
             AND createdAt >= :from AND createdAt < :to) x
         WHERE rn = 1 AND r = 'OK'${shiftSql}`, {
        replacements: { from: ctx.win.from, to: ctx.win.to, shift: q.shiftCode ? String(q.shiftCode).trim().toUpperCase() : null },
        type: sequelize.QueryTypes.SELECT,
      });
      // In progress = parts cast in the period still in process; Total = OK + NG + In progress (Dashboard rule)
      inProgress = Math.max(0, totalProduction - totalOK - totalNG);
      totalOK = Math.max(totalOK, Number(r?.ok || 0));
      totalProduction = totalOK + totalNG + inProgress;
    } catch (err) {
      console.warn("[HistoricalReport] final OK count failed:", err.message);
    }
  }
  // Pass rate over completed parts only (OK + NG); parts still in process are excluded
  const passRate = (totalOK + totalNG) > 0 ? Number(((totalOK / (totalOK + totalNG)) * 100).toFixed(2)) : 0;
  const ngCategories = await ngSplitPromise;
  return {
    metrics: {
      totalProduction, totalOK, totalNG,
      passed: totalOK, // keeping for backward compatibility
      failed: totalNG,
      inProgress, passRate, ngCategories,
    },
    gateWip,
  };
}

exports.getHistoricalReportData = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    // capped at the largest page the UI offers (10 000) so a hand-written URL cannot pull an unbounded page
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize || req.query.limit, 10) || 1000, 10), 10000);
    const offset = (page - 1) * pageSize;

    const q = req.query || {};
    const { getPlcReadingColumns } = require("../services/report/reportExportService");
    const plcColumnsPromise = getPlcReadingColumns();
    plcColumnsPromise.catch(() => {}); // awaited below

    // Filters (shared with the Excel export)
    const ctx = await historicalFilterContext(q);
    const { stationScope, leak } = ctx;
    const gateSortDir = String(q.sortBy || "") === "gateScanAt" ? (String(q.sortDir || "").toLowerCase() === "asc" ? "asc" : "desc") : "default";
    // Station gate: the part set is worked out once (see loadGateSet) — totals, OK / NG and the page all come from it
    const reqStatus = String(q.status || "").trim().toUpperCase();
    // Gate view with no status filter: the parts waiting for the gate ("in progress") are counted alongside OK / NG
    const wipPromise = stationScope && ctx.win && !reqStatus ? loadGateWip(q, ctx) : null;
    if (wipPromise) wipPromise.catch(() => {}); // awaited below
    const gateSet = await loadGateSet(q, { ctx, order: gateSortDir });

    let count;
    let rows;
    let gateTimes;
    let summaryPromise;
    // the selected gate's own result per report row (OK / NG from the decisive scan, IN_PROGRESS = waiting for it)
    let gateStatusById = new Map();
    if (gateSet) {
      count = gateSet.rows.length;
      summaryPromise = historicalSummary({ q, ctx, gateSet, wipPromise });
      summaryPromise.catch(() => {}); // awaited below
      const pageRows = gateSet.rows.slice(offset, offset + pageSize);
      // raw_logs comes gzip-compressed (findReportsWithLogs): ~40 % faster for a 100-part page
      const found = await findReportsWithLogs(pageRows.map((r) => r.id));
      const byId = new Map(found.map((r) => [r.id, r]));
      rows = pageRows.map((r) => byId.get(r.id)).filter(Boolean);
      gateTimes = new Map(pageRows.filter((r) => r.scanAt).map((r) => [r.id, r.scanAt]));
      gateStatusById = new Map(pageRows.map((r) => [r.id, r.status ? classifyStatus(r.status) : null]));
    } else {
      const { where, statusExpr } = await buildHistoricalWhere(q, { ctx });
      // 1. Fetch Paginated Rows
      const order = historicalOrder(q, stationScope, leak);
      // 2. Metrics (and the NG split) — grouped by the selected gate's status (station column, leak result) or the part status
      summaryPromise = historicalSummary({ q, ctx, where, statusExpr, wipPromise });
      summaryPromise.catch(() => {}); // awaited below
      const page1 = await ProductionReport.findAndCountAll({ where, limit: pageSize, offset, order, attributes: ["id"], raw: true })
        .then(async ({ count: n, rows: idRows }) => {
          const found = await findReportsWithLogs(idRows.map((r) => r.id));
          const byId = new Map(found.map((r) => [r.id, r]));
          return { count: n, rows: idRows.map((r) => byId.get(r.id)).filter(Boolean) };
        });
      ({ count, rows } = page1);
      gateTimes = await gateScanTimes(rows, stationScope, leak);
      if (leak) rows.forEach((row) => { const st = leakResultOf(row.leak_data); if (st) gateStatusById.set(row.id, classifyStatus(st)); });
    }

    const plcColumnSet = await plcColumnsPromise;
    const { metrics: summaryMetrics, gateWip } = await summaryPromise;

    // 3. Format rows back exactly as the UI expects (array of OperationLog arrays)
    // The Master Table stored the raw OperationLog entries array in `raw_logs` for this part.
    // The UI's `paginateReportRowsByPart` grouping logic expects an array of these raw OperationLog entries.
    // So we just flatten the `raw_logs` array of arrays into a single array of raw logs, 
    // exactly like `getLegacyReportBundle` would return!
    const rejInfo = await rejectionInfoFor(rows, categoryGateHint(stationScope, leak));
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
      if (stationScope) {
        const gateStatus = gateStatusById.get(row.id) || null;
        // shift of the gate scan (gate view column) — Shift Management timings
        const gateShift = gateShiftOf(gateScanAt, ctx.shiftDefs);
        rawLogs.forEach((log) => { log.__pr_gate_status = gateStatus; log.__pr_gate_shift = gateShift; });
      }
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
        ...summaryMetrics,
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
      gateScope: stationScope ? {
        station: stationScope, leakMachineId: leak?.machineId ?? null, leakMachineName: leak?.machineName || null,
        // what "in progress" means for this gate: previous gate (OP160: leak test, OP140 when a part has no leak result)
        inProgress: gateWip ? { count: gateWip.count, previousGate: gateWip.previous, fallbackGate: gateWip.viaLeak ? "OP140" : null } : null,
      } : null,
      warning: undefined,
    };

    if (reportPrivate?.wantsCleanReportResponse && reportPrivate.wantsCleanReportResponse(req.query || {})) {
      const clean = reportPrivate.formatCleanReportResponse(payload);
      // the clean format keeps a fixed field list: carry the gate result per record (same order as payload.rows)
      // and the gate definition across
      if (stationScope && Array.isArray(clean.records)) {
        clean.records.forEach((rec, i) => {
          if (rec && formattedRows[i]) {
            rec.__pr_gate_status = formattedRows[i].__pr_gate_status ?? null;
            rec.__pr_gate_shift = formattedRows[i].__pr_gate_shift || null;
          }
        });
      }
      if (clean.summary) {
        clean.summary.gateScope = payload.gateScope;
        // CR / MR / CRAM split of the NG figure (whole filtered set)
        clean.summary.ngCategories = summaryMetrics.ngCategories;
      }
      res.json(clean);
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

/* ═══════════════════════════════════════════════════════════════════════════
   Excel export.

   30 days ≈ 24 k parts / 450 MB of raw_logs JSON. The old export paged with OFFSET (each page re-ran the whole
   filter: 278 s), kept every log of every part in memory (2.7 GB) and sent nothing until the end, so the
   download died on proxy / browser timeouts or the process ran out of heap. Now:
   1. the ordered id list is read once (same filter + order as before, < 1 s);
   2. reports are read by id in chunks, a few chunks in flight, with raw_logs gzip-compressed by SQL Server
      (COMPRESS → ~9× less data on the wire) and unzipped here off the main thread;
   3. each chunk is turned into report rows straight away and the raw text dropped — only one summary row per
      part is kept;
   4. the workbook is streamed to a temp file (ExcelJS WorkbookWriter);
   5. it runs as a background job (exportJobService): the browser polls progress and downloads the finished file.
   ═══════════════════════════════════════════════════════════════════════════ */
const zlib = require("zlib");
const { promisify } = require("util");
const gunzipAsync = promisify(zlib.gunzip);
const exportJobs = require("../services/report/exportJobService");

const EXPORT_CHUNK_SIZE = 500;
// chunk reads in flight (DB connections used by one export)
const EXPORT_CONCURRENCY = Math.min(8, Math.max(1, Number(process.env.HIST_EXPORT_CONCURRENCY) || 3));

/* raw_logs (nvarchar(max), ~18 KB per part as UTF-16) is the bulk of every read. SQL Server converts it to UTF-8
   (a UTF-8 collation keeps every character, so the text is identical) and gzips it: half the bytes to compress and
   ~8× less on the wire than the plain column; unzipped here on the zlib thread pool. Falls back to the UTF-16
   COMPRESS when the server has no UTF-8 collations (SQL Server < 2019). */
const RAW_LOGS_GZ_UTF8 = "COMPRESS(CAST([ProductionReport].[raw_logs] COLLATE Latin1_General_100_CI_AS_SC_UTF8 AS varchar(max)))";
const RAW_LOGS_GZ_UTF16 = "COMPRESS([ProductionReport].[raw_logs])";
let rawLogsEncoding = "utf8";
const REPORT_COLUMNS_NO_LOGS = () => Object.keys(ProductionReport.rawAttributes).filter((c) => c !== "raw_logs");

/** Report rows by id with raw_logs as text (same values as a plain read). Order of the result is not defined. */
async function findReportsWithLogs(ids, { attributes = REPORT_COLUMNS_NO_LOGS() } = {}) {
  if (!ids.length) return [];
  const read = (encoding) => ProductionReport.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: [...attributes, [sequelize.literal(encoding === "utf8" ? RAW_LOGS_GZ_UTF8 : RAW_LOGS_GZ_UTF16), "raw_logs_gz"]],
    raw: true,
  });
  let encoding = rawLogsEncoding;
  let rows;
  try {
    rows = await read(encoding);
  } catch (err) {
    if (encoding !== "utf8" || !/collation|Latin1_General_100_CI_AS_SC_UTF8/i.test(String(err?.message || err?.parent?.message || ""))) throw err;
    rawLogsEncoding = encoding = "utf16le";
    rows = await read(encoding);
  }
  await Promise.all(rows.map(async (r) => {
    const gz = r.raw_logs_gz;
    delete r.raw_logs_gz;
    r.raw_logs = gz && gz.length ? (await gunzipAsync(gz)).toString(encoding) : null;
  }));
  return rows;
}

// Logs of one report row, ready for the Excel engine (sorted, trimmed to the gate, stamped with gate time,
// rejection details and master status / times) — the same steps the export always did.
function exportLogsOfReport(report, rawLogs, gateTimes, rejInfo, stationScope, leak) {
  if (!Array.isArray(rawLogs)) return [];
  rawLogs.sort((a, b) => {
    const tA = new Date(a.createdAt || a.plc_end_time || 0).getTime();
    const tB = new Date(b.createdAt || b.plc_end_time || 0).getTime();
    return tA - tB;
  });
  const gateScanAt = gateTimes.get(report.id);
  const logs = trimLogsToGate(rawLogs, stationScope, leak);
  if (gateScanAt) logs.forEach((log) => { log.__pr_gate_scan_at = gateScanAt; });
  stampRejection(logs, rejInfo.get(report.id));
  const masterOverallStatus = partStatusOf(report);
  const masterFinalScanAt = report.final_scan_at ? new Date(report.final_scan_at).toISOString() : null;
  const masterFirstScanAt = report.first_scan_at ? new Date(report.first_scan_at).toISOString() : null;
  logs.forEach((log) => {
    log.__pr_overall_status = masterOverallStatus;
    log.__pr_final_scan_at = masterFinalScanAt;
    log.__pr_first_scan_at = masterFirstScanAt;
  });
  return logs;
}

const parseRawLogs = (text) => {
  if (text == null) return null;
  try { return JSON.parse(text); } catch (e) { void e; return []; }
};

/**
 * Builds the historical Excel report into `filePath`. `onProgress({ progress, phase, rows })` is called as it goes.
 * Returns { rows: parts in the report, logs }.
 */
/** Thrown when the user cancels an export job. */
class ExportCancelled extends Error {
  constructor() { super("Export cancelled"); this.cancelled = true; }
}

/**
 * Number of parts an export with these filters will contain (same rules as the export) — for the "23,665 parts ·
 * about 1 min" estimate shown before / while exporting. Station gates reuse the one-pass gate set.
 */
async function countHistoricalParts(filters = {}) {
  const ctx = await historicalFilterContext(filters);
  const gateSet = await loadGateSet(filters, { ctx });
  if (gateSet) return gateSet.rows.length;
  const { where } = await buildHistoricalWhere(filters, { ctx });
  return ProductionReport.count({ where });
}

// Human-readable filter values for the Excel title block
function describeExportPeriod(filters, win) {
  const fmt = (d) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  if (!win) return "All dates";
  const df = String(filters.dateFrom || ""), dt = String(filters.dateTo || "");
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/;
  const days = dayOnly.test(df) && dayOnly.test(dt) ? (df === dt ? `production day ${df}` : `production days ${df} → ${dt}`) : "";
  return `${fmt(win.from)} → ${fmt(win.to)}${days ? ` (${days})` : ""}`;
}
function gateLabelFor(stationScope, leak, machines) {
  if (!stationScope) return "";
  if (leak) return leak.machineName ? `${leak.machineName} (OP150)` : "Leak Test OP150";
  const m = machines.find((x) => String(x.operation_no || "").trim().toUpperCase() === stationScope);
  const name = m ? String(m.machine_name || "").trim() : "";
  return name && name.toUpperCase() !== stationScope ? `${name} (${stationScope})` : stationScope;
}

async function runHistoricalExport({ filters = {}, reportConfig = {}, type = "full", filePath, onProgress = () => {}, isCancelled = () => false }) {
  const { formatCleanReportResponse } = reportPrivate;
  const xl = require("../services/report/historicalExcelService");
  const fmt = (n) => Number(n).toLocaleString("en-IN");
  const checkCancel = () => { if (isCancelled()) throw new ExportCancelled(); };
  // phase timings (ms) — logged at the end and used for the next export's time estimate
  const timing = { find: 0, readWait: 0, fold: 0, prepare: 0, write: 0 };
  let mark = Date.now();
  const lap = (key) => { const now = Date.now(); timing[key] += now - mark; mark = now; };
  const q = filters || {};

  onProgress({ progress: 1, phase: "Finding parts" });
  // Same filters, same order and same figures as the page (shared builders): the gate set / where clause, the
  // gate-scan-time sort when the page is sorted by it, and historicalSummary() for the totals block.
  const ctx = await historicalFilterContext(q);
  const { stationScope, leak } = ctx;
  const gateSortDir = String(q.sortBy || "") === "gateScanAt" ? (String(q.sortDir || "").toLowerCase() === "asc" ? "asc" : "desc") : "default";
  const reqStatus = String(q.status || "").trim().toUpperCase();
  const wipPromise = stationScope && ctx.win && !reqStatus ? loadGateWip(q, ctx) : null;
  if (wipPromise) wipPromise.catch(() => {}); // awaited by historicalSummary
  const machinesPromise = sequelize.query(
    "SELECT id, machine_name, operation_no FROM Machines ORDER BY sequence_no ASC, id ASC",
    { type: sequelize.QueryTypes.SELECT },
  );
  machinesPromise.catch(() => {}); // awaited below
  const gateSet = await loadGateSet(q, { ctx, order: gateSortDir });
  let ids;
  let knownGateTimes = null;
  let summaryPromise;
  const gateStatusById = new Map();
  if (gateSet) {
    ids = gateSet.rows.map((r) => r.id);
    knownGateTimes = new Map(gateSet.rows.filter((r) => r.scanAt).map((r) => [r.id, r.scanAt]));
    gateSet.rows.forEach((r) => gateStatusById.set(r.id, r.status ? classifyStatus(r.status) : null));
    summaryPromise = historicalSummary({ q, ctx, gateSet, wipPromise });
  } else {
    const { where, statusExpr } = await buildHistoricalWhere(q, { ctx });
    summaryPromise = historicalSummary({ q, ctx, where, statusExpr, wipPromise });
    ids = (await ProductionReport.findAll({
      where,
      attributes: ["id"],
      order: historicalOrder(q, stationScope, leak),
      raw: true,
    })).map((r) => r.id);
  }
  summaryPromise.catch(() => {}); // awaited below
  const totalParts = ids.length;
  lap("find");
  checkCancel();
  onProgress({ progress: 3, phase: `Reading ${fmt(totalParts)} parts`, rows: totalParts });

  const chunks = [];
  for (let i = 0; i < ids.length; i += EXPORT_CHUNK_SIZE) chunks.push(ids.slice(i, i + EXPORT_CHUNK_SIZE));
  const gateHint = categoryGateHint(stationScope, leak);

  // read one chunk: report rows in id-list order, raw logs unzipped (zlib thread pool), gate times, rejections
  const fetchChunk = async (chunkIds) => {
    if (isCancelled()) return { reports: [], texts: [], gateTimes: new Map(), rejInfo: new Map() };
    const found = await findReportsWithLogs(chunkIds);
    const byId = new Map(found.map((r) => [String(r.id), r]));
    const reports = chunkIds.map((id) => byId.get(String(id))).filter(Boolean);
    const texts = reports.map((r) => { const t = r.raw_logs; r.raw_logs = null; return t; });
    const [gateTimes, rejInfo] = await Promise.all([
      knownGateTimes || gateScanTimes(reports, stationScope, leak),
      rejectionInfoFor(reports, gateHint),
    ]);
    return { reports, texts, gateTimes, rejInfo };
  };

  const gateOp = leak ? "OP150" : (stationScope || "");
  const shaped = [];
  const rowStations = new Map();
  const inFlight = [];
  let next = 0;
  const launch = () => {
    while (inFlight.length < EXPORT_CONCURRENCY && next < chunks.length) {
      const p = fetchChunk(chunks[next++]);
      p.catch(() => {}); // handled when awaited in order
      inFlight.push(p);
    }
  };
  let processed = 0;
  launch();
  try {
    while (inFlight.length) {
      lap("fold");
      const chunk = await inFlight.shift();
      lap("readWait");
      checkCancel();
      launch(); // keep the next reads going while this chunk is processed
      const { reports, texts, gateTimes, rejInfo } = chunk;
      for (let i = 0; i < reports.length; i += 1) {
        const rep = reports[i];
        const rawLogs = parseRawLogs(texts[i]);
        texts[i] = null;
        const logs = exportLogsOfReport(rep, rawLogs, gateTimes, rejInfo, stationScope, leak);
        if (stationScope) {
          // the gate's own result / shift, exactly as the page stamps them
          const gateStatus = gateSet ? (gateStatusById.get(rep.id) || null) : (leak ? (() => { const s = leakResultOf(rep.leak_data); return s ? classifyStatus(s) : null; })() : null);
          const gateShift = gateShiftOf(gateTimes.get(rep.id), ctx.shiftDefs);
          logs.forEach((log) => { log.__pr_gate_status = gateStatus; log.__pr_gate_shift = gateShift; });
        }
        logs.forEach((log) => { if (log.leakTestReadings && log.leakTestReading) delete log.leakTestReading; });
        // the page renders the API's clean records — the file is built from the very same records
        const { records } = formatCleanReportResponse({ rows: logs });
        records.forEach((rec, k) => {
          rec.__pr_gate_status = logs[k].__pr_gate_status ?? null;
          rec.__pr_gate_shift = logs[k].__pr_gate_shift || null;
          const op = String(rec.station?.operation || "").trim();
          const name = String(rec.station?.name || "").trim();
          if (op && name && !rowStations.has(op.toUpperCase())) rowStations.set(op.toUpperCase(), { machineName: name, op });
        });
        shaped.push(xl.shapeHistoricalPart(records, { gateView: Boolean(stationScope), gateOp }));
        // keep the event loop free for API requests / scanning while a big export runs
        if (i % 50 === 49) await new Promise((resolve) => setImmediate(resolve));
      }
      processed += reports.length;
      onProgress({
        progress: 3 + (totalParts ? (processed / totalParts) * 52 : 52),
        phase: `Reading parts ${fmt(processed)} / ${fmt(totalParts)}`,
      });
    }
  } finally {
    // on cancel / error: let the reads still in flight finish quietly (they skip work once cancelled)
    inFlight.forEach((p) => p.catch(() => {}));
  }
  lap("fold");
  checkCancel();

  onProgress({ progress: 56, phase: "Preparing Excel" });
  const machines = await machinesPromise.catch(() => []);
  const { metrics, gateWip } = await summaryPromise;
  const gateLabel = gateLabelFor(stationScope, leak, machines);
  const columns = xl.buildHistoricalColumns({
    gateView: Boolean(stationScope),
    gateLabel,
    gateOp,
    stationPairs: xl.stationPairsOf(machines, [...rowStations.values()]),
    // like the page: the leak-test history column only when a part was tested more than once
    includeLeakHistory: shaped.some((r) => r.leakHistory),
  });
  const statusName = { OK: "OK", PASSED: "OK", NG: "NG", FAILED: "NG", WIP: "In Progress", IN_PROGRESS: "In Progress" }[reqStatus] || "All";
  const search = String(q.barcode || q.customerCode || q.partId || "").trim();
  const prevGate = gateWip?.previous === "OP150" ? "the leak test" : (gateWip?.previous || "");
  const company = [reportConfig.companyName, reportConfig.plantName].map((s) => String(s || "").trim()).filter(Boolean).join(" · ");
  lap("prepare");
  const { records } = await xl.writeHistoricalWorkbook(filePath, {
    columns,
    rows: shaped,
    sheetName: type === "ng" ? "Historical NG Report" : "Historical Report",
    meta: {
      title: `Traceability Report — ${stationScope ? `${gateLabel} (gate view)` : "Historical Production"}`,
      subtitle: [company, "One row per part · statuses: OK / NG / In Progress"].filter(Boolean).join("  ·  "),
      period: describeExportPeriod(q, ctx.win),
      shift: q.shiftCode ? String(q.shiftCode).replace(/_/g, " ") : "All shifts",
      gate: stationScope ? gateLabel : "All stations",
      status: statusName,
      search,
      generatedAt: xl.formatPlantTime(new Date()),
      footer: reportConfig.footerText || "Traceability system export",
    },
    summary: {
      gateView: Boolean(stationScope),
      gateLabel,
      total: metrics.totalProduction,
      ok: metrics.totalOK,
      ng: metrics.totalNG,
      inProgress: metrics.inProgress,
      passRate: metrics.passRate,
      ngCategories: metrics.ngCategories,
      wipNote: stationScope && gateWip ? `Passed ${prevGate} in the period${gateWip.viaLeak ? " (or OP140, for parts with no leak test result)" : ""}, no result at ${gateLabel} yet` : "",
    },
    isCancelled,
    onProgress: (done, total) => {
      checkCancel();
      onProgress({
        progress: 58 + (total ? (done / total) * 41 : 41),
        phase: `Writing Excel rows ${fmt(done)} / ${fmt(total)}`,
      });
    },
  }).catch((err) => { if (err?.cancelled) throw new ExportCancelled(); throw err; });
  lap("write");
  const secs = (ms) => (ms / 1000).toFixed(1);
  console.log(`[HistoricalReport] export ${fmt(totalParts)} parts: find ${secs(timing.find)} s, read wait ${secs(timing.readWait)} s, fold ${secs(timing.fold)} s, prepare ${secs(timing.prepare)} s, write ${secs(timing.write)} s (${EXPORT_CONCURRENCY} reads in flight, ${rawLogsEncoding})`);
  return { rows: records, parts: totalParts, timing, summary: metrics };
}

const exportFilePrefix = (type) => (type === "ng" ? "HISTORICAL_NG_REPORT" : "HISTORICAL_FULL_REPORT");

function queueHistoricalExport(req) {
  const { filters = {}, reportConfig = {}, type = "full" } = req.body || {};
  const { nowStamp } = require("../services/report/excelTemplateEngine");
  return exportJobs.createJob({
    userId: req.user?.id,
    label: "historical-export",
    fileName: `${exportFilePrefix(type)}_${nowStamp()}.xlsx`,
    run: (filePath, update, { isCancelled } = {}) => runHistoricalExport({ filters, reportConfig, type, filePath, onProgress: update, isCancelled }),
  });
}

function sendExportFile(job, res, { deleteAfter } = {}) {
  const fs = require("fs");
  if (job.fileDeleted || !fs.existsSync(job.filePath)) {
    res.status(410).json({ error: "The export file is no longer available. Please export again." });
    return;
  }
  const size = fs.statSync(job.filePath).size;
  const safeName = String(job.fileName || "report.xlsx").replace(/[^\w.-]/g, "_");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.setHeader("Content-Length", String(size));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  const stream = fs.createReadStream(job.filePath);
  stream.on("error", (err) => {
    console.error("[HistoricalReport] export file read failed:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.destroy(err);
  });
  res.on("finish", () => exportJobs.scheduleFileDeletion(job, deleteAfter));
  stream.pipe(res);
}

// POST /report/historical/export/jobs  { filters, reportConfig, type } → 202 { jobId, status, … }
exports.createHistoricalExportJob = async (req, res) => {
  try {
    const job = queueHistoricalExport(req);
    res.status(202).json(exportJobs.publicView(job));
  } catch (error) {
    console.error("[HistoricalReport] export job create error:", error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

// GET /report/historical/export/jobs/:jobId → { status: queued|running|done|error, progress, phase, rows, error, … }
exports.getHistoricalExportJob = (req, res) => {
  const job = exportJobs.getJob(req.params.jobId, req.user?.id);
  if (!job) return res.status(404).json({ error: "Export job not found" });
  res.setHeader("Cache-Control", "no-store");
  return res.json(exportJobs.publicView(job));
};

// GET /report/historical/export/jobs/:jobId/file → the finished .xlsx
exports.downloadHistoricalExportJob = (req, res) => {
  const job = exportJobs.getJob(req.params.jobId, req.user?.id);
  if (!job) return res.status(404).json({ error: "Export job not found" });
  if (job.status === "error") return res.status(500).json({ error: job.error || "Export failed" });
  if (job.status !== "done") return res.status(409).json({ ...exportJobs.publicView(job), error: "Export is not finished yet" });
  return sendExportFile(job, res);
};

// DELETE /report/historical/export/jobs/:jobId → cancel (queued / running) or discard the finished file. Owner only.
exports.cancelHistoricalExportJob = (req, res) => {
  const job = exportJobs.getJob(req.params.jobId, req.user?.id);
  if (!job) return res.status(404).json({ error: "Export job not found" });
  exportJobs.cancelJob(job);
  res.setHeader("Cache-Control", "no-store");
  return res.json(exportJobs.publicView(job));
};

// GET /report/historical/export/estimate?<filters> → { parts, etaSeconds } — shown before / while exporting
exports.estimateHistoricalExport = async (req, res) => {
  try {
    const parts = await countHistoricalParts(req.query || {});
    res.setHeader("Cache-Control", "no-store");
    res.json({ parts, etaSeconds: exportJobs.estimateSeconds(parts) });
  } catch (error) {
    console.error("[HistoricalReport] export estimate error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Old single-request export (kept for compatibility): same background pipeline and queue, the response waits
// for the file.
exports.exportHistoricalReportExcel = async (req, res) => {
  try {
    req.setTimeout?.(15 * 60 * 1000);
    res.setTimeout?.(15 * 60 * 1000);
    const job = queueHistoricalExport(req);
    await job.done;
    if (job.status !== "done") {
      if (!res.headersSent) res.status(500).json({ error: job.error || "Export failed" });
      return;
    }
    if (req.destroyed || res.destroyed) { exportJobs.scheduleFileDeletion(job, 0); return; }
    sendExportFile(job, res, { deleteAfter: 0 });
  } catch (error) {
    console.error("[HistoricalReport] Excel export error:", error);
    if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.message });
  }
};

exports._private = { runHistoricalExport };
