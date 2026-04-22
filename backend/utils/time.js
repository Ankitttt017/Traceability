const TIME_PREFIX_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const ISO_TIME_RE = /T(\d{2}):(\d{2})(?::(\d{2}))?/i;

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidParts(hours, minutes, seconds) {
  return (
    Number.isFinite(hours) &&
    Number.isFinite(minutes) &&
    Number.isFinite(seconds) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59 &&
    seconds >= 0 &&
    seconds <= 59
  );
}

function parseFromRegexMatch(match) {
  if (!match) {
    return null;
  }
  const hours = toInt(match[1]);
  const minutes = toInt(match[2]);
  const seconds = toInt(match[3] ?? "0");
  if (!isValidParts(hours, minutes, seconds)) {
    return null;
  }
  return { hours, minutes, seconds };
}

function parseTimeParts(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return {
      hours: value.getUTCHours(),
      minutes: value.getUTCMinutes(),
      seconds: value.getUTCSeconds(),
    };
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const directTime = parseFromRegexMatch(raw.match(TIME_PREFIX_RE));
  if (directTime) {
    return directTime;
  }

  const isoTime = parseFromRegexMatch(raw.match(ISO_TIME_RE));
  if (isoTime) {
    return isoTime;
  }

  const parsedDate = new Date(raw);
  if (Number.isFinite(parsedDate.getTime())) {
    return {
      hours: parsedDate.getUTCHours(),
      minutes: parsedDate.getUTCMinutes(),
      seconds: parsedDate.getUTCSeconds(),
    };
  }

  return null;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatTime(parts, { includeSeconds = true } = {}) {
  if (!parts) {
    return "";
  }
  const hh = pad2(parts.hours);
  const mm = pad2(parts.minutes);
  if (!includeSeconds) {
    return `${hh}:${mm}`;
  }
  return `${hh}:${mm}:${pad2(parts.seconds)}`;
}

function normalizeTimeValue(value, { includeSeconds = true } = {}) {
  const parsed = parseTimeParts(value);
  if (!parsed) {
    return "";
  }
  return formatTime(parsed, { includeSeconds });
}

function toMinutes(value) {
  const parsed = parseTimeParts(value);
  if (!parsed) {
    return null;
  }
  return parsed.hours * 60 + parsed.minutes;
}

function isMinuteWithinShift(current, start, end, { inclusiveEnd = false } = {}) {
  if (current === null || start === null || end === null) {
    return false;
  }
  if (start === end) {
    return true;
  }
  if (start < end) {
    return inclusiveEnd
      ? current >= start && current <= end
      : current >= start && current < end;
  }
  return inclusiveEnd ? current >= start || current <= end : current >= start || current < end;
}

module.exports = {
  parseTimeParts,
  normalizeTimeValue,
  toMinutes,
  isMinuteWithinShift,
};
