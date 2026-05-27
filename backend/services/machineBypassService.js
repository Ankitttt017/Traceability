const machineBypassState = new Map();

function normalizeMachineId(machineId) {
  const id = Number(machineId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.trunc(id);
}

function normalizeReason(value, fallback = "MANUAL_BYPASS_FROM_MACHINE_PAGE") {
  const reason = String(value || "").trim();
  return reason || fallback;
}

function setMachineBypass(machineId, enabled, reason, userId = null) {
  const id = normalizeMachineId(machineId);
  if (!id) {
    throw new Error("Valid machineId is required");
  }

  const now = new Date().toISOString();
  const current = machineBypassState.get(id) || {};
  const next = {
    machineId: id,
    enabled: Boolean(enabled),
    reason: normalizeReason(reason),
    updatedAt: now,
    updatedBy: userId || null,
    createdAt: current.createdAt || now,
  };
  machineBypassState.set(id, next);
  return next;
}

function getMachineBypass(machineId) {
  const id = normalizeMachineId(machineId);
  if (!id) return null;
  return machineBypassState.get(id) || null;
}

function isMachineBypassEnabled(machineId) {
  const state = getMachineBypass(machineId);
  return Boolean(state?.enabled);
}

module.exports = {
  setMachineBypass,
  getMachineBypass,
  isMachineBypassEnabled,
};
