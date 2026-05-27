const QUIET_INDUSTRIAL_LOGS = String(process.env.QUIET_INDUSTRIAL_LOGS || "true").trim().toLowerCase() !== "false";
const SUPPRESSED_WARN_EVENTS = new Set([
  "WATCHDOG_PLC_UNHEALTHY",
  "WATCHDOG_BACKEND_HEARTBEAT",
]);

function toLogLine(event, payload = {}) {
  const safe = Object.entries(payload)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`)
    .join(" ");
  return `[INDUSTRIAL:${event}] ${safe}`;
}

function logInfo(event, payload) {
  console.log(toLogLine(event, payload));
}

function logWarn(event, payload) {
  if (QUIET_INDUSTRIAL_LOGS && SUPPRESSED_WARN_EVENTS.has(String(event || "").trim().toUpperCase())) {
    return;
  }
  console.warn(toLogLine(event, payload));
}

function logError(event, payload) {
  console.error(toLogLine(event, payload));
}

function logPlc(machineId, event, payload = {}) {
  const line = toLogLine(event, { machineId, ...payload });
  console.log(line.replace("[INDUSTRIAL:", "[PLC:"));
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  logPlc,
};
