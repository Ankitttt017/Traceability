const { toMinutes, toSeconds } = require("../../utils/time");

const PROD_DAY_START_SECONDS = 6 * 3600; // 06:00:00
const PROD_DAY_START_MINUTES = PROD_DAY_START_SECONDS / 60; // Backward-compatible export.
const DEFAULT_PLANNED_BREAK_SECONDS = Number(process.env.PLANNED_BREAK_SECONDS || 0);
const DEFAULT_PLANNED_DOWNTIME_SECONDS = Number(process.env.PLANNED_DOWNTIME_SECONDS || 0);
const GAP_THRESHOLD_MS = 5 * 60 * 1000;

function toDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getMinutesForDate(dateValue) {
  const date = toDate(dateValue);
  if (!date) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function getSecondsForDate(dateValue) {
  const date = toDate(dateValue);
  if (!date) return null;
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function getProductionDayStartSeconds(shifts = []) {
  const starts = (Array.isArray(shifts) ? shifts : [])
    .map((shift) => toSeconds(shift?.start_time ?? shift?.startTime))
    .filter((value) => value !== null);
  return starts.length ? Math.min(...starts) : PROD_DAY_START_SECONDS;
}

function getProductionDate(dateValue, shifts = []) {
  const date = toDate(dateValue);
  if (!date) return null;
  const startSeconds = getProductionDayStartSeconds(shifts);
  const out = new Date(date);
  if (getSecondsForDate(date) < startSeconds) {
    out.setDate(out.getDate() - 1);
  }
  out.setHours(0, 0, 0, 0);
  return out;
}

function setDateSeconds(baseDate, seconds) {
  const date = toDate(baseDate);
  if (!date) return null;
  date.setHours(Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60, 0);
  return date;
}

function getProductionDayRange(dateValue = new Date(), shifts = []) {
  const productionDate = getProductionDate(dateValue, shifts);
  if (!productionDate) return null;
  const startSeconds = getProductionDayStartSeconds(shifts);
  const start = setDateSeconds(productionDate, startSeconds);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function isDateInShift(dateValue, shift) {
  const currentSeconds = getSecondsForDate(dateValue);
  if (currentSeconds === null) return false;
  const start = toSeconds(shift.start_time);
  const end = toSeconds(shift.end_time);
  if (start === null || end === null) return false;
  if (start === end) return true;
  if (start < end) return currentSeconds >= start && currentSeconds <= end;
  return currentSeconds >= start || currentSeconds <= end;
}

function resolveShift(dateValue, shifts = []) {
  const matches = [];
  for (const shift of shifts) {
    if (isDateInShift(dateValue, shift)) {
      const start = toSeconds(shift.start_time);
      const end = toSeconds(shift.end_time);
      const duration = start === end ? 24 * 3600 : start < end ? end - start : (24 * 3600 - start + end);
      matches.push({ shift, start, duration });
    }
  }
  if (matches.length) {
    matches.sort((a, b) => (b.start - a.start) || (a.duration - b.duration));
    return matches[0].shift;
  }
  return null;
}

function getShiftDurationSeconds(shift) {
  if (!shift) return 0;
  const start = toSeconds(shift.start_time);
  const end = toSeconds(shift.end_time);
  if (start === null || end === null) return 0;
  if (start === end) return 24 * 3600;
  const seconds = start < end ? (end - start) : (24 * 3600 - start + end);
  return Math.max(0, seconds);
}

function getEffectiveCycleTimeSeconds(machine = {}) {
  const std = Number(machine.standard_cycle_time_sec ?? machine.standardCycleTimeSec ?? machine.cycle_time ?? machine.cycleTime ?? 0);
  const load = Number(machine.loading_time_sec ?? machine.loadingTimeSec ?? machine.loading_time ?? machine.loadingTime ?? 0);
  const effective = std + load;
  return effective > 0 ? effective : 0;
}

function computeTargetProduction({ machine, shift, plannedBreakSeconds, plannedDowntimeSeconds }) {
  const effectiveCycleTime = getEffectiveCycleTimeSeconds(machine);
  if (effectiveCycleTime <= 0) {
    return Math.max(0, Number(machine.daily_target_qty ?? machine.dailyTargetQty ?? machine.targetQty ?? machine.targetProduction ?? 0));
  }
  const shiftDurationSeconds = getShiftDurationSeconds(shift);
  const plannedBreak = Number.isFinite(plannedBreakSeconds) ? plannedBreakSeconds : DEFAULT_PLANNED_BREAK_SECONDS;
  const plannedDowntime = Number.isFinite(plannedDowntimeSeconds) ? plannedDowntimeSeconds : DEFAULT_PLANNED_DOWNTIME_SECONDS;
  const available = Math.max(0, shiftDurationSeconds - plannedBreak - plannedDowntime);
  return Math.floor(available / effectiveCycleTime);
}

function computeDowntimeFromLogs(logs = []) {
  if (!Array.isArray(logs) || logs.length < 2) {
    return { downtimeMs: 0, downtimeMinutes: 0, downtimeEvents: 0 };
  }
  let downtimeMs = 0;
  let downtimeEvents = 0;
  for (let i = 1; i < logs.length; i++) {
    const prev = toDate(logs[i - 1]?.createdAt);
    const curr = toDate(logs[i]?.createdAt);
    if (!prev || !curr) continue;
    const gap = curr.getTime() - prev.getTime();
    if (gap > GAP_THRESHOLD_MS) {
      downtimeMs += gap;
      downtimeEvents += 1;
    }
  }
  return { downtimeMs, downtimeMinutes: Math.round(downtimeMs / 60000), downtimeEvents };
}

function computeOeeAndOa({
  totalCount = 0,
  goodCount = 0,
  runtimeSeconds = 0,
  plannedProductionSeconds = 0,
  idealCycleTimeSeconds = 0,
  downtimeSeconds = 0,
}) {
  const planned = Math.max(0, Number(plannedProductionSeconds || 0));
  const runtime = Math.max(0, Number(runtimeSeconds || 0));
  const total = Math.max(0, Number(totalCount || 0));
  const good = Math.max(0, Number(goodCount || 0));
  const idealCT = Math.max(0, Number(idealCycleTimeSeconds || 0));
  const downtime = Math.max(0, Number(downtimeSeconds || 0));

  const availability = planned > 0 ? runtime / planned : 0;
  let performance = 0;
  if (runtime > 0 && idealCT > 0) {
    performance = (idealCT * total) / runtime;
  }
  performance = Math.min(performance, 1.2);
  const quality = total > 0 ? good / total : 0;
  const oee = availability * performance * quality;
  const oa = (runtime + downtime) > 0 ? runtime / (runtime + downtime) : 0;

  return {
    availabilityPct: Math.round(availability * 100),
    performancePct: Math.round(performance * 100),
    qualityPct: Math.round(quality * 100),
    oeePct: Math.round(oee * 100),
    oaPct: Math.round(oa * 100),
  };
}

module.exports = {
  PROD_DAY_START_MINUTES,
  getProductionDate,
  getProductionDayStartSeconds,
  getProductionDayRange,
  resolveShift,
  getShiftDurationSeconds,
  getEffectiveCycleTimeSeconds,
  computeTargetProduction,
  computeDowntimeFromLogs,
  computeOeeAndOa,
};
