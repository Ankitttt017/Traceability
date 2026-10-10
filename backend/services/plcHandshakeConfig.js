/**
 * Effective PLC handshake register map of one machine.
 *
 * Priority: the top-level Machine column, then the saved Machine-page config
 * (plc_registers JSON: startRegister / statusRegister / endOkRegister / ...).
 * A register of 0 / empty is treated as NOT CONFIGURED (never D0) — a machine
 * whose Start or Running register is missing must not receive a START write.
 */

function parseSnapshot(machine = {}) {
  try {
    const raw = machine?.plc_registers;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw || {});
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function toRegister(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function toValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function firstRegister(...candidates) {
  for (const candidate of candidates) {
    const reg = toRegister(candidate);
    if (reg !== null) return reg;
  }
  return null;
}

function resolveHandshakeConfig(machine = {}) {
  const s = parseSnapshot(machine);
  const startRegister = firstRegister(machine?.plc_start_register, s.startRegister);
  const statusRegister = firstRegister(machine?.plc_status_register, machine?.plc_running_register, s.statusRegister, s.runningRegister);
  const endOkConfigured = firstRegister(machine?.plc_end_ok_register, s.endOkRegister);
  const endNgConfigured = firstRegister(machine?.plc_end_ng_register, s.endNgRegister);
  const cfg = {
    startRegister,
    statusRegister,
    // END registers fall back to the STATUS register only when no END register is configured.
    endOkRegister: endOkConfigured ?? statusRegister,
    endNgRegister: endNgConfigured ?? statusRegister,
    endOkConfigured: endOkConfigured !== null,
    endNgConfigured: endNgConfigured !== null,
    resetRegister: firstRegister(machine?.plc_reset_register, s.resetRegister),
    blockRegister: firstRegister(machine?.plc_block_register, s.blockRegister),
    bypassRegister: firstRegister(machine?.plc_bypass_register, s.bypassRegister),
    partRegister: firstRegister(machine?.plc_part_register, s.partRegister),
    stationRegister: firstRegister(machine?.plc_station_register, s.stationRegister),
    startValue: toValue(machine?.plc_start_value ?? s.startValue, 1),
    startedValue: toValue(machine?.plc_started_value ?? s.startedValue, 1),
    endOkValue: toValue(machine?.plc_end_ok_value ?? s.endOkValue, 2),
    endNgValue: toValue(machine?.plc_end_ng_value ?? s.endNgValue, 2),
    resetValue: toValue(machine?.plc_reset_value ?? s.resetValue, 1),
    blockValue: toValue(machine?.plc_block_value ?? s.blockValue, 2),
    bypassValue: toValue(machine?.plc_bypass_value ?? s.bypassValue, 1),
    staleEndClearMs: Math.max(toValue(s.staleEndClearMs ?? process.env.PLC_STALE_END_CLEAR_MS, 3000), 0),
  };
  const missing = [];
  if (cfg.startRegister === null) missing.push("START");
  if (cfg.statusRegister === null) missing.push("RUNNING/STATUS");
  cfg.missing = missing;
  cfg.configured = missing.length === 0;
  return cfg;
}

// SLMP only: for Modbus, holding register 0 (40001) is a valid address.
const REGISTER_PROTOCOLS = new Set(["SLMP"]);

/** Null when the handshake can run, else a clear operator/maintenance message. */
function getHandshakeConfigIssue(machine = {}) {
  const protocol = String(machine?.plc_protocol || "").trim().toUpperCase();
  if (!REGISTER_PROTOCOLS.has(protocol)) return null;
  const cfg = resolveHandshakeConfig(machine);
  if (cfg.configured) return null;
  const name = machine?.machine_name || `machine ${machine?.id || "?"}`;
  return `PLC not configured for ${name}: ${cfg.missing.join(" and ")} register is 0 / missing. ` +
    "No START was sent. Configure the handshake registers on the Machine page, or turn PLC communication OFF for this machine in Station Control.";
}

function createNotConfiguredError(machine = {}) {
  const err = new Error(getHandshakeConfigIssue(machine) || "PLC not configured");
  err.code = "PLC_NOT_CONFIGURED";
  err.noRetry = true;
  return err;
}

module.exports = {
  resolveHandshakeConfig,
  getHandshakeConfigIssue,
  createNotConfiguredError,
  toRegister,
};
