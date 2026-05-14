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
