/* Period helpers. Dates are production days (06:00 → 06:00): the server counts each date from Shift A start
   to the next day's Shift A start, so the night shift stays on the date it started. */
export const DAY_START_HOUR = 6;
const DAY_MS = 24 * 3600 * 1000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The production day running at `now`: before Shift A starts it is still yesterday's production day. */
export const productionToday = (now = new Date()) => new Date(now.getTime() - DAY_START_HOUR * 3600 * 1000);

export const localISODate = (d) => {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
};

export const PERIODS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
  { value: "month", label: "This month" },
];

/** Period choices of the Rejection Analysis header (one dropdown; "Custom" opens the date-range picker). */
export const RA_PERIODS = [
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "last90", label: "Last 90 days" },
];

export const SHIFTS = [
  { value: "", label: "All shifts" },
  { value: "SHIFT_A", label: "A" },
  { value: "SHIFT_B", label: "B" },
  { value: "SHIFT_C", label: "C" },
];

/** Date range of a preset. "7 days" / "30 days" end today and include today (7 / 30 production days). */
export function presetRange(preset) {
  const now = productionToday();
  const today = localISODate(now);
  if (preset === "today") return { dateFrom: today, dateTo: today };
  if (preset === "yesterday") { const y = localISODate(new Date(now.getTime() - DAY_MS)); return { dateFrom: y, dateTo: y }; }
  if (preset === "last7") return { dateFrom: localISODate(new Date(now.getTime() - 6 * DAY_MS)), dateTo: today };
  if (preset === "last90") return { dateFrom: localISODate(new Date(now.getTime() - 89 * DAY_MS)), dateTo: today };
  if (preset === "month") return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
  return { dateFrom: localISODate(new Date(now.getTime() - 29 * DAY_MS)), dateTo: today };
}

const parse = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const fmtDay = (d) => `${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]} ${d.getFullYear()}`;

/** "05 Oct 2026" for one day, "01 Oct 2026 – 05 Oct 2026" for a range. */
export const rangeLabel = (from, to) => {
  const a = parse(from), b = parse(to || from);
  if (!a || !b) return "";
  return a.getTime() === b.getTime() ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;
};

export const dayCount = (from, to) => {
  const a = parse(from), b = parse(to || from);
  return a && b ? Math.round((b - a) / 86400000) + 1 : 0;
};

/** Local start (06:00) of a production date. */
const dayStart = (ymd) => {
  const d = parse(ymd);
  if (!d) return null;
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  return d;
};

/** true when the period reaches the running production day (its numbers still grow). */
export const includesNow = (dateTo, now = new Date()) => !!dateTo && dateTo >= localISODate(productionToday(now));

/**
 * Exact window of a period up to now: { dateFrom, dateTo } as ISO timestamps (for endpoints that take times, e.g. OEE).
 * Call it when the request is made — never put the result in a React dependency (it moves with the clock).
 */
export function periodWindowIso({ dateFrom, dateTo }, now = new Date()) {
  const a = dayStart(dateFrom), b = dayStart(dateTo || dateFrom);
  if (!a || !b) return null;
  const end = new Date(Math.min(b.getTime() + DAY_MS, now.getTime()));
  return { dateFrom: a.toISOString(), dateTo: end.toISOString() };
}

/**
 * The window right before the period, of the same length. When the period is still running (it includes the
 * current production day) the previous window is cut at the same elapsed time — "today until 14:05" is compared
 * with "yesterday until 14:05", "last 7 days" with the 7 days before, up to the same hour.
 * Returns { dateFrom, dateTo, label, live } — dates as YYYY-MM-DD (whole days) or ISO timestamps (live).
 * Call it when the request is made (live windows move with the clock).
 */
export function previousWindow({ dateFrom, dateTo }, now = new Date()) {
  const n = dayCount(dateFrom, dateTo);
  const a = dayStart(dateFrom);
  if (!n || !a) return null;
  const shift = n * DAY_MS;
  const label = n === 1 ? "vs day before" : `vs previous ${n} days`;
  if (includesNow(dateTo, now)) {
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    return {
      dateFrom: new Date(a.getTime() - shift).toISOString(),
      dateTo: new Date(now.getTime() - shift).toISOString(),
      label: n === 1 ? `vs yesterday to ${hhmm}` : `vs previous ${n} days (same hour)`,
      live: true,
    };
  }
  return {
    dateFrom: localISODate(new Date(a.getTime() - shift)),
    dateTo: localISODate(new Date(a.getTime() - DAY_MS)),
    label,
    live: false,
  };
}

/** Short label of the previous window without calling the clock-dependent parts (for headings). */
export const previousLabel = (from, to) => {
  const n = dayCount(from, to);
  if (!n) return "";
  return n === 1 ? (includesNow(to) ? "vs yesterday, same time" : "vs day before") : `vs previous ${n} days`;
};
