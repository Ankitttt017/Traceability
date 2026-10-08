/**
 * Production-day and shift rules — one definition for every report.
 *
 * Production day: a calendar date D means [D at the earliest shift start, D+1 at that time),
 * e.g. with Shift A starting 06:00 → 5 Oct = 5 Oct 06:00:00 → 6 Oct 06:00:00 (end exclusive).
 * So Shift C (23:00 → 05:59:59) belongs to the day it STARTED on.
 *
 * Shift of a timestamp: the active shift whose [start_time, end_time] (end second inclusive, as entered in
 * Shift Management, e.g. 06:00:00 – 14:29:59) contains the plant-local time of day. Shifts that cross midnight
 * (23:00:00 – 05:59:59) wrap.
 *
 * Plant time zone: REPORT_TIMEZONE (default Asia/Kolkata). SQL uses a fixed offset (PLANT_UTC_OFFSET_MINUTES,
 * default 330 = IST, which has no daylight saving) because timestamps are stored in UTC.
 */
const PLANT_TZ = process.env.REPORT_TIMEZONE || "Asia/Kolkata";
const PLANT_OFFSET_MIN = Number(process.env.PLANT_UTC_OFFSET_MINUTES || 330);
const DEFAULT_DAY_START_SEC = 6 * 3600;

const timeToSeconds = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    // TIME columns arrive as 1970-01-01T06:00:00.000Z — read them as wall-clock UTC fields
    return value.getUTCHours() * 3600 + value.getUTCMinutes() * 60 + value.getUTCSeconds();
  }
  const m = String(value).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
};

/** Seconds since plant-local midnight for a Date. */
const plantSecondOfDay = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(d.getTime() + PLANT_OFFSET_MIN * 60000);
  return local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
};

const dayStartSeconds = (shifts = []) => {
  const starts = (shifts || []).map((s) => timeToSeconds(s.start_time ?? s.startTime)).filter((v) => v !== null);
  return starts.length ? Math.min(...starts) : DEFAULT_DAY_START_SEC;
};

/** Plant-local wall-clock date parts → UTC Date. */
const plantDate = (y, mo, d, sec = 0) =>
  new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - PLANT_OFFSET_MIN * 60000 + sec * 1000);

const parseDateOnly = (value) => {
  const m = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
};

/**
 * Window for a date filter.
 *  - Date-only values ("2026-10-05") → production days: [from 06:00, (to + 1 day) 06:00)
 *  - Full timestamps are used as given (the caller already chose exact times)
 *  - The end never goes past "now"
 * Returns { from, to } with `to` EXCLUSIVE.
 */
function productionWindow({ dateFrom, dateTo, shifts = [], now = new Date() } = {}) {
  const startSec = dayStartSeconds(shifts);
  const df = parseDateOnly(dateFrom), dt = parseDateOnly(dateTo || dateFrom);
  let from, to;
  if (df) from = plantDate(df.y, df.mo, df.d, startSec);
  else if (dateFrom) from = new Date(dateFrom);
  if (dt) to = new Date(plantDate(dt.y, dt.mo, dt.d, startSec).getTime() + 24 * 3600 * 1000);
  else if (dateTo) to = new Date(dateTo);
  if (!from || Number.isNaN(from.getTime())) from = currentProductionDay(shifts, now).from;
  if (!to || Number.isNaN(to.getTime())) to = new Date(from.getTime() + 24 * 3600 * 1000);
  if (to > now) to = new Date(now);
  return { from, to };
}

/** The production day containing `now`. */
function currentProductionDay(shifts = [], now = new Date()) {
  const startSec = dayStartSeconds(shifts);
  const local = new Date(now.getTime() + PLANT_OFFSET_MIN * 60000);
  let from = plantDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), startSec);
  if (from > now) from = new Date(from.getTime() - 24 * 3600 * 1000);
  return { from, to: new Date(from.getTime() + 24 * 3600 * 1000) };
}

/** Shift code for a timestamp, from the shift definitions (null when none matches). */
function shiftCodeAt(date, shifts = []) {
  const sec = plantSecondOfDay(date);
  if (sec === null) return null;
  for (const s of shifts || []) {
    const a = timeToSeconds(s.start_time ?? s.startTime), b = timeToSeconds(s.end_time ?? s.endTime);
    if (a === null || b === null) continue;
    const hit = a <= b ? sec >= a && sec <= b : sec >= a || sec <= b;
    if (hit) return s.shift_code || s.shiftCode || null;
  }
  return null;
}

/**
 * SQL expression giving the shift code of a UTC timestamp column, built from the active shift definitions —
 * so shift filters and shift totals follow Shift Management, not a label stored at sync time.
 */
function shiftCaseSql(column, shifts = []) {
  const sec = `DATEDIFF(SECOND, CAST(CAST(DATEADD(MINUTE, ${PLANT_OFFSET_MIN}, ${column}) AS date) AS datetime2), DATEADD(MINUTE, ${PLANT_OFFSET_MIN}, ${column}))`;
  const whens = (shifts || []).map((s) => {
    const a = timeToSeconds(s.start_time ?? s.startTime), b = timeToSeconds(s.end_time ?? s.endTime);
    const code = String(s.shift_code || s.shiftCode || "").replace(/'/g, "''");
    if (a === null || b === null || !code) return "";
    return a <= b
      ? ` WHEN ${sec} BETWEEN ${a} AND ${b} THEN '${code}'`
      : ` WHEN ${sec} >= ${a} OR ${sec} <= ${b} THEN '${code}'`;
  }).join("");
  return `(CASE WHEN ${column} IS NULL THEN 'UNASSIGNED'${whens} ELSE 'UNASSIGNED' END)`;
}

/** Shift length in seconds, end second inclusive (06:00:00 – 14:29:59 = 8 h 30 m). */
function shiftDurationSeconds(shift) {
  const a = timeToSeconds(shift?.start_time ?? shift?.startTime), b = timeToSeconds(shift?.end_time ?? shift?.endTime);
  if (a === null || b === null) return null;
  return (b >= a ? b - a : 24 * 3600 - a + b) + 1;
}

/**
 * Rows that are scanner misreads, not parts: several labels read as one ID (longer than 32 characters), a stray
 * character or fragment (shorter than 7), or a partial ID never seen at OP100/OP110 (where part IDs are created)
 * that is neither a full part ID (letter first, 20–32 characters) nor a 13-digit customer QR.
 * They are left out of every report and total — except NG rows, so no recorded scrap is ever hidden.
 * Plain column names (works with or without the pr. prefixing used by the rejection queries).
 */
const VALID_SCAN_SQL = `NOT ((
    LEN(ISNULL(part_id, '')) > 32
    OR LEN(ISNULL(part_id, '')) < 7
    OR (ISNULL(station_keys, '') NOT LIKE '%OP100%' AND ISNULL(station_keys, '') NOT LIKE '%OP110%'
        AND NOT (ISNULL(part_id, '') NOT LIKE '%[^0-9]%' AND LEN(ISNULL(part_id, '')) = 13)
        AND NOT (ISNULL(part_id, '') LIKE '[A-Za-z]%' AND LEN(ISNULL(part_id, '')) BETWEEN 20 AND 32))
  ) AND ISNULL(overall_status, '') NOT IN ('NG', 'FAILED'))`;

module.exports = {
  PLANT_TZ, PLANT_OFFSET_MIN, timeToSeconds, plantSecondOfDay, dayStartSeconds,
  productionWindow, currentProductionDay, shiftCodeAt, shiftCaseSql, shiftDurationSeconds, VALID_SCAN_SQL,
};
