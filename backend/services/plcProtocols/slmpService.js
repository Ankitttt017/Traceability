// UPGRADE 1 COMPLETE — 32-bit Part/Station hash via dual-word SLMP writeWords
const { sleep, withTimeout, hashToRegisterValue, split32To16 } = require("./utils");
const { withSocket } = require("./socketPool");
const { resolveHandshakeConfig, createNotConfiguredError } = require("../plcHandshakeConfig");

const DEFAULT_CONNECT_TIMEOUT_MS = Number(process.env.PLC_CONNECT_TIMEOUT_MS || 2000);
const DEFAULT_START_ACK_TIMEOUT_MS = Number(process.env.PLC_START_ACK_TIMEOUT_MS || 3000);
const DEFAULT_END_ACK_TIMEOUT_MS = Number(process.env.PLC_END_ACK_TIMEOUT_MS || 120000);
const DEFAULT_SLMP_POLL_INTERVAL_MS = Number(process.env.PLC_SLMP_POLL_INTERVAL_MS || 150);
const DEFAULT_SLMP_FRAME_MODE = String(process.env.PLC_SLMP_FRAME_MODE || "AUTO")
  .trim()
  .toUpperCase();
const DEFAULT_SIGNAL_HOLD_MS = Math.max(Number(process.env.PLC_SIGNAL_HOLD_MS || 700), 100);
const DEFAULT_START_HOLD_MS = Math.max(Number(process.env.PLC_START_HOLD_MS || 300), 0);
// Last frame mode (ASCII / BINARY) that worked per endpoint: tried first next time, so an AUTO machine does
// not pay a failed ASCII attempt (connect + 2 s timeout) on every cycle.
const workingFrameMode = new Map();
function orderFrameModes(modes, ip, port) {
  const known = workingFrameMode.get(`${ip}:${port}`);
  return known && modes.includes(known) ? [known, ...modes.filter((m) => m !== known)] : modes;
}
const STRICT_START_ACK_REQUIRED = String(process.env.PLC_STRICT_START_ACK_REQUIRED || "true").trim().toLowerCase() !== "false";

const DEVICE_CODES = {
  D: 0xa8,
  M: 0x90,
  X: 0x9c,
  Y: 0x9d,
  W: 0xb4,
  L: 0x92,
  F: 0x93,
  V: 0x94,
  B: 0xa0,
  R: 0xaf,
};

function toByte(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 0), 255);
}

function toUInt16(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 0), 0xffff);
}

function normalizeDevice(value, fallback = "D") {
  const key = String(value || "").trim().toUpperCase();
  const normalized = DEVICE_CODES[key] ? key : fallback;
  // STEP 9 — Verify Address Normalization
  if (value && value.toUpperCase() !== normalized) {
    console.log(`[PLC:NORMALIZED_ADDRESS] input=${value} output=${normalized}`);
  }
  return normalized;
}

function normalizeFrameMode(value, fallback = "AUTO") {
  const mode = String(value || "").trim().toUpperCase();
  if (mode === "ASCII" || mode === "BINARY" || mode === "AUTO") return mode;
  return fallback;
}

function isRetryableSlmpAttemptError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("invalid slmp") ||
    message.includes("slmp end code") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("ehostunreach") ||
    message.includes("socket hang up") ||
    message.includes("write after end")
  );
}

function getFrameModeCandidates(machine = {}) {
  let snapshotMode = null;
  try {
    const parsed =
      typeof machine?.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine?.plc_registers;
    snapshotMode = normalizeFrameMode(parsed?.slmpFrameMode ?? parsed?.slmpFrame ?? parsed?.frameMode, null);
  } catch (_error) {
    snapshotMode = null;
  }

  const fromMachine = normalizeFrameMode(
    machine?.plc_slmp_frame_mode ??
    machine?.plcSlmpFrameMode ??
    machine?.slmpFrameMode ??
    snapshotMode ??
    null,
    null
  );
  const selected = fromMachine || normalizeFrameMode(DEFAULT_SLMP_FRAME_MODE, "AUTO");
  if (selected === "ASCII") return ["ASCII", "BINARY"];
  if (selected === "BINARY") return ["BINARY", "ASCII"];
  return ["ASCII", "BINARY"];
}

function resolveTimingConfig(machine = {}) {
  let snapshot = {};
  try {
    snapshot = typeof machine?.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine?.plc_registers || {};
  } catch (_error) {
    snapshot = {};
  }
  const signalHoldMs = Math.max(Number(snapshot?.signalHoldMs || snapshot?.plcSignalHoldMs || DEFAULT_SIGNAL_HOLD_MS), 100);
  return {
    signalHoldMs,
    // Minimum time START stays set before it is cleared after RUNNING (Machine start_hold_ms, e.g. 500 ms).
    startHoldMs: Math.max(Number(snapshot?.startHoldMs ?? machine?.start_hold_ms ?? DEFAULT_START_HOLD_MS) || 0, 0),
    pollIntervalMs: Math.max(Number(snapshot?.pollIntervalMs || snapshot?.plcPollIntervalMs || DEFAULT_SLMP_POLL_INTERVAL_MS), 50),
    startAckTimeoutMs: Math.max(Number(snapshot?.startAckTimeoutMs || machine?.plc_start_ack_timeout_ms || DEFAULT_START_ACK_TIMEOUT_MS), 300),
    endAckTimeoutMs: Math.max(Number(snapshot?.endAckTimeoutMs || machine?.plc_end_ack_timeout_ms || DEFAULT_END_ACK_TIMEOUT_MS), 1000),
  };
}

function parseMachineSnapshot(machine = {}) {
  try {
    return typeof machine?.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine?.plc_registers || {};
  } catch (_error) {
    return {};
  }
}



function resolveBinAckConfig(machine = {}) {
  let signalMap = [];
  try {
    signalMap = typeof machine?.plc_signal_map === "string" ? JSON.parse(machine.plc_signal_map) : machine?.plc_signal_map || [];
  } catch (e) { signalMap = []; }

  if (!Array.isArray(signalMap)) signalMap = [];

  const found = signalMap.find(row => {
    const s = String(row.signal || row.label || "").toUpperCase();
    return s.includes("BIN") && (s.includes("ACK") || s.includes("DEP") || s.includes("KEEP") || s.includes("PLACE"));
  });

  if (found && Number.isFinite(Number(found.register))) {
    return {
      enabled: true,
      register: Number(found.register),
      value: Number(found.value ?? 1),
      label: found.signal || found.label || "BIN_ACK"
    };
  }
  return { enabled: false };
}

function parseSignalMap(raw) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.map((entry) => ({
      key: String(entry?.key || entry?.signal || entry?.name || "").trim().toUpperCase(),
      device: entry?.device ? String(entry.device).trim().toUpperCase() : null,
    }));
  } catch (_error) {
    return null;
  }
}

function resolveDevice(machine, signalKey) {
  const fallback = normalizeDevice(process.env.PLC_SLMP_DEVICE || "D", "D");

  let resolved = null;
  let source = null;

  // 1. Try to resolve from SIGNAL_MAP first to allow custom device type override per signal!
  if (machine && machine.plc_signal_map) {
    const map = parseSignalMap(machine.plc_signal_map);
    if (map) {
      const found = map.find((entry) => entry.key === String(signalKey || "").trim().toUpperCase());
      if (found?.device) {
        resolved = normalizeDevice(found.device, fallback);
        source = "SIGNAL_MAP";
      }
    }
  }

  // 2. Fall back to machine configuration device type
  if (!resolved && machine && machine.plc_slmp_device) {
    resolved = normalizeDevice(machine.plc_slmp_device, fallback);
    source = "MACHINE_CONFIG";
  }

  // 3. Fall back to environment variable or "D"
  if (!resolved) {
    resolved = fallback;
    source = "ENV_FALLBACK";
  }

  console.log(`[PLC:REGISTER_RESOLVE] signal=${signalKey} input=${machine?.plc_slmp_device || "NULL"} resolve=${resolved} source=${source}`);
  return resolved;
}

function buildDeviceSpec(address, device) {
  const buffer = Buffer.alloc(4);
  buffer.writeUIntLE(Math.max(0, Number(address) || 0), 0, 3);
  buffer.writeUInt8(DEVICE_CODES[device] || DEVICE_CODES.D, 3);
  return buffer;
}

function toHexByte(value) {
  return toByte(value).toString(16).toUpperCase().padStart(2, "0");
}

function toHexUInt16(value) {
  return toUInt16(value).toString(16).toUpperCase().padStart(4, "0");
}

function toLeHexUInt16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(toUInt16(value), 0);
  return b.toString("hex").toUpperCase();
}

function buildFrameBinary({ command, subcommand, data = Buffer.alloc(0), monitoringTimer = 0x0010 }) {
  const networkNo = toByte(process.env.PLC_SLMP_NETWORK_NO || 0);
  const plcNo = toByte(process.env.PLC_SLMP_PLC_NO || 0xff);
  const ioNo = toUInt16(process.env.PLC_SLMP_IO_NO || 0x03ff);
  const stationNo = toByte(process.env.PLC_SLMP_STATION_NO || 0);

  const requestDataLength = 2 + 2 + 2 + data.length;
  const frame = Buffer.alloc(9 + requestDataLength);

  frame.writeUInt16LE(0x0050, 0); // subheader 3E binary (0x50,0x00)
  frame.writeUInt8(networkNo, 2);
  frame.writeUInt8(plcNo, 3);
  frame.writeUInt16LE(ioNo, 4);
  frame.writeUInt8(stationNo, 6);
  frame.writeUInt16LE(requestDataLength, 7);
  frame.writeUInt16LE(toUInt16(monitoringTimer), 9);
  frame.writeUInt16LE(command, 11);
  frame.writeUInt16LE(subcommand, 13);
  if (data.length > 0) {
    data.copy(frame, 15);
  }
  return frame;
}

function buildFrameAscii({ command, subcommand, data = Buffer.alloc(0), monitoringTimer = 0x0010 }) {
  const networkNo = toByte(process.env.PLC_SLMP_NETWORK_NO || 0);
  const plcNo = toByte(process.env.PLC_SLMP_PLC_NO || 0xff);
  const ioNo = toUInt16(process.env.PLC_SLMP_IO_NO || 0x03ff);
  const stationNo = toByte(process.env.PLC_SLMP_STATION_NO || 0);

  const payloadHex =
    `${toLeHexUInt16(monitoringTimer)}` +
    `${toLeHexUInt16(command)}` +
    `${toLeHexUInt16(subcommand)}` +
    `${data.toString("hex").toUpperCase()}`;
  const requestDataLength = payloadHex.length;
  const frameText =
    "5000" +
    toHexByte(networkNo) +
    toHexByte(plcNo) +
    toHexUInt16(ioNo) +
    toHexByte(stationNo) +
    toHexUInt16(requestDataLength) +
    payloadHex;
  return Buffer.from(frameText, "ascii");
}

function buildFrame(options = {}, frameMode = "BINARY") {
  const mode = normalizeFrameMode(frameMode, "BINARY");
  return mode === "ASCII" ? buildFrameAscii(options) : buildFrameBinary(options);
}

async function sendAndReceivePacket(socket, frame, timeoutMs, frameMode = "BINARY") {
  const mode = normalizeFrameMode(frameMode, "BINARY");
  return withTimeout(
    new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);

      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (mode === "ASCII") {
          const text = buffer
            .toString("ascii")
            .toUpperCase()
            .replace(/[^0-9A-F]/g, "");
          if (text.length < 18) return;
          const declaredLength = parseInt(text.slice(14, 18), 16);
          if (!Number.isFinite(declaredLength)) return;
          const expectedA = 18 + declaredLength;
          const expectedB = 18 + declaredLength * 2;
          if (text.length >= expectedB || text.length >= expectedA) {
            cleanup();
            resolve(buffer);
          }
          return;
        }
        if (buffer.length < 9) return;
        const payloadLength = buffer.readUInt16LE(7);
        const totalLength = 9 + payloadLength;
        if (buffer.length >= totalLength) {
          cleanup();
          resolve(buffer.subarray(0, totalLength));
        }
      };

      socket.on("data", onData);
      socket.on("error", onError);
      socket.write(frame);
    }),
    timeoutMs,
    "PLC packet timeout"
  );
}

function parseResponse(packet) {
  const text = packet
    .toString("ascii")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
  if (text.length >= 22 && /^[0-9A-F]+$/.test(text)) {
    const declaredLength = parseInt(text.slice(14, 18), 16);
    if (Number.isFinite(declaredLength)) {
      const payloadStart = 18;
      const candidates = [declaredLength * 2, declaredLength].filter((len) => len >= 4);
      const payloadLength = candidates.find((len) => text.length >= payloadStart + len);
      if (payloadLength) {
        const payloadHex = text.slice(payloadStart, payloadStart + payloadLength);
        const endCodeHex = payloadHex.slice(0, 4);
        const endCodeLE = parseInt(`${endCodeHex.slice(2, 4)}${endCodeHex.slice(0, 2)}`, 16);
        const endCodeBE = parseInt(endCodeHex, 16);
        const isOk = endCodeLE === 0x0000 || endCodeBE === 0x0000;
        if (!isOk) {
          const code = Number.isFinite(endCodeLE) ? endCodeLE : endCodeBE;
          throw new Error(`SLMP end code 0x${String(code || 0).toString(16).padStart(4, "0")}`);
        }
        const dataHex = payloadHex.slice(4);
        if (dataHex.length % 2 !== 0) {
          throw new Error("Invalid SLMP ASCII data length");
        }
        return Buffer.from(dataHex, "hex");
      }
    }
  }

  if (packet.length < 11) {
    throw new Error("Invalid SLMP response length");
  }
  const payloadLength = packet.readUInt16LE(7);
  const endCodeOffset = 9;
  if (packet.length < endCodeOffset + 2) {
    throw new Error("Invalid SLMP response payload");
  }
  const endCode = packet.readUInt16LE(endCodeOffset);
  if (endCode !== 0x0000) {
    throw new Error(`SLMP end code 0x${endCode.toString(16).padStart(4, "0")}`);
  }
  const dataOffset = endCodeOffset + 2;
  const dataLength = Math.max(0, payloadLength - 2);
  return packet.subarray(dataOffset, dataOffset + dataLength);
}

async function readWords(socket, { device, address, count, timeoutMs, frameMode = "BINARY" }) {
  const deviceSpec = buildDeviceSpec(address, device);
  const points = Buffer.alloc(2);
  points.writeUInt16LE(count, 0);
  const data = Buffer.concat([deviceSpec, points]);
  const frame = buildFrame({ command: 0x0401, subcommand: 0x0000, data }, frameMode);
  const packet = await sendAndReceivePacket(socket, frame, timeoutMs, frameMode);
  const payload = parseResponse(packet);
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const offset = i * 2;
    if (offset + 2 <= payload.length) {
      values.push(payload.readUInt16LE(offset));
    }
  }
  return values;
}

async function writeWords(socket, { device, address, values, timeoutMs, frameMode = "BINARY" }) {
  const deviceSpec = buildDeviceSpec(address, device);
  const points = Buffer.alloc(2);
  points.writeUInt16LE(values.length, 0);
  const dataWords = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => {
    dataWords.writeUInt16LE(value & 0xffff, index * 2);
  });
  const data = Buffer.concat([deviceSpec, points, dataWords]);
  const frame = buildFrame({ command: 0x1401, subcommand: 0x0000, data }, frameMode);
  const packet = await sendAndReceivePacket(socket, frame, timeoutMs, frameMode);
  parseResponse(packet);
}

/**
 * Data registers configured on the Machine page (plc_registers.dataRegisterRanges, e.g. leak tester
 * "Leak Rate" D2258-59, "Gall-1" D2254-55, "Gall-2" D2256-57). Contiguous word ranges of one device are read
 * in a single request (D2254..D2259 = one 6-word read). Returns raw words per range; decoding happens in
 * leakTestCaptureService.
 */
function parseDataRanges(machine = {}) {
  const snapshot = parseMachineSnapshot(machine);
  const rows = Array.isArray(snapshot?.dataRegisterRanges) ? snapshot.dataRegisterRanges : [];
  return rows
    .map((row) => {
      const startReg = Number(row?.startReg);
      const endReg = Number(row?.endReg);
      const count = Math.max(1, Number(row?.count) || (Number.isFinite(endReg) && endReg >= startReg ? endReg - startReg + 1 : 1));
      return {
        name: String(row?.name || "").trim() || `REG_${row?.startReg}`,
        device: normalizeDevice(String(row?.device || "D"), "D"),
        startReg,
        count: Math.min(count, 64),
        dataType: String(row?.dataType || "INT16").toUpperCase(),
        unit: String(row?.unit || "").trim(),
      };
    })
    .filter((row) => Number.isFinite(row.startReg) && row.startReg >= 0);
}

async function readDataRanges(read, ranges = []) {
  const out = [];
  const byDevice = new Map();
  for (const range of ranges) {
    if (!byDevice.has(range.device)) byDevice.set(range.device, []);
    byDevice.get(range.device).push(range);
  }
  for (const [device, list] of byDevice.entries()) {
    const sorted = [...list].sort((a, b) => a.startReg - b.startReg);
    let group = [];
    const flush = async () => {
      if (!group.length) return;
      const from = group[0].startReg;
      const to = Math.max(...group.map((r) => r.startReg + r.count - 1));
      try {
        const words = await read(device, from, to - from + 1);
        for (const r of group) out.push({ ...r, words: words.slice(r.startReg - from, r.startReg - from + r.count) });
      } catch (error) {
        for (const r of group) out.push({ ...r, words: null, error: String(error?.message || "READ_FAILED") });
      }
      group = [];
    };
    for (const range of sorted) {
      const groupEnd = group.length ? Math.max(...group.map((r) => r.startReg + r.count - 1)) : null;
      if (group.length && (range.startReg > groupEnd + 1 || range.startReg + range.count - group[0].startReg > 64)) {
        await flush();
      }
      group.push(range);
    }
    await flush();
  }
  return out;
}

/**
 * One SLMP handshake cycle on an open (pooled) socket — exported for unit tests with a fake io.
 *
 * Sequence (Machine page I/O, e.g. OP150 leak tester):
 *   0. Stale END guard: if END OK/NG (D362) already holds an end value before START, write RESET (D363=resetValue),
 *      wait up to staleEndClearMs (default 3 s) for D362 to clear, release RESET. If it does not clear, log
 *      STALE_END_SIGNAL and continue, but an END value is then accepted only after the PLC has cleared D362 once
 *      (edge) — the stale result can never be taken as this part's result, and the line is not stopped.
 *   1. START: write startRegister = startValue (D360=1) — no pre-read / verify-read round trips.
 *   2. Wait RUNNING: poll statusRegister for startedValue (D361 = 1 on LT-1, 2 on LT-2) every pollIntervalMs,
 *      starting immediately. END values are accepted on the STATUS register only when END lives on that register.
 *      START is cleared (D360=0) as soon as RUNNING is seen and START has been held ≥ startHoldMs.
 *   3. Wait END: endOkRegister = endOkValue (D362=1) or endNgRegister = endNgValue (D362=2). Data registers are
 *      read on the same socket right away, and the result is handed to hooks.onEnd immediately (operator popup /
 *      DB) — before the RESET pulse.
 *   4. RESET pulse: resetRegister = resetValue, hold signalHoldMs, then 0 (D363=1 → 0). A failure here is logged
 *      (RESET_FAILED) but does not turn the already-detected END result into a communication error.
 */
async function runHandshakeOnSocket(socket, { machine, partId, stationNo, frameMode, cfg, timing, io = { readWords, writeWords }, hooks = {} }) {
  const {
    startRegister, statusRegister, endOkRegister, endNgRegister, resetRegister, partRegister, stationRegister,
    startValue, startedValue, endOkValue, endNgValue, resetValue,
  } = cfg;
  const machineId = machine?.id;
  const t0 = Date.now();
  const marks = [];
  const mark = (step) => marks.push({ step, atMs: Date.now() - t0 });
  const deviceStart = resolveDevice(machine, "TRIGGER");
  const devicePart = resolveDevice(machine, "PART_ID");
  const deviceStation = resolveDevice(machine, "STATION_ID");
  const deviceEndOk = cfg.endOkConfigured ? resolveDevice(machine, "END_OK") : resolveDevice(machine, "STATUS");
  const deviceEndNg = cfg.endNgConfigured ? resolveDevice(machine, "END_NG") : resolveDevice(machine, "STATUS");
  const deviceReset = resolveDevice(machine, "RESET");
  const deviceStatus = resolveDevice(machine, "STATUS");
  const readN = (device, address, count) => io.readWords(socket, {
    device: device || "D", address, count, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS, frameMode,
  });
  const read1 = async (device, address) => (await readN(device, address, 1))[0];
  const write1 = (device, address, value) => io.writeWords(socket, {
    device: device || "D", address, values: [value], timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS, frameMode,
  });
  const callHook = (name, ...args) => {
    if (typeof hooks[name] !== "function") return;
    try {
      Promise.resolve(hooks[name](...args)).catch((error) => console.error(`[PLC:HOOK_${name}_FAILED] machineId=${machineId}: ${error.message}`));
    } catch (error) {
      console.error(`[PLC:HOOK_${name}_FAILED] machineId=${machineId}: ${error.message}`);
    }
  };

  console.log(`[PLC:SIGNALS_OK] machineId=${machineId} frame=${frameMode} START=${deviceStart}${startRegister}=${startValue} RUNNING=${deviceStatus}${statusRegister}=${startedValue} END_OK=${deviceEndOk}${endOkRegister}=${endOkValue} END_NG=${deviceEndNg}${endNgRegister}=${endNgValue} RESET=${resetRegister === null ? "none" : `${deviceReset}${resetRegister}=${resetValue}`} poll=${timing.pollIntervalMs}ms startHold=${timing.startHoldMs}ms resetHold=${timing.signalHoldMs}ms startAck=${timing.startAckTimeoutMs}ms endAck=${timing.endAckTimeoutMs}ms`);

  const endOnStatusRegister = (endOkRegister === statusRegister && deviceEndOk === deviceStatus)
    || (endNgRegister === statusRegister && deviceEndNg === deviceStatus);
  const sameEndRegister = endNgRegister === endOkRegister && deviceEndNg === deviceEndOk;
  const readEnd = async () => {
    const ok = await read1(deviceEndOk, endOkRegister);
    const ng = sameEndRegister ? ok : await read1(deviceEndNg, endNgRegister);
    return { ok, ng, isOk: ok === endOkValue, isNg: ng === endNgValue, isEnd: ok === endOkValue || ng === endNgValue };
  };

  let startCommandActive = false;
  let startWritten = false;
  let startWrittenAt = 0;
  const clearStart = async (reason) => {
    if (!startCommandActive) return;
    await write1(deviceStart, startRegister, 0);
    startCommandActive = false;
    mark(`START_CLEARED(${reason})`);
    console.log(`[PLC:START_CLEARED] machineId=${machineId} register=${deviceStart}${startRegister} value=0 reason=${reason}`);
  };
  try {
    // 0. Stale END guard (before START).
    let staleEnd = false;
    const preEnd = await readEnd();
    mark("PRE_END_READ");
    if (preEnd.isEnd) {
      console.warn(`[PLC:STALE_END_SIGNAL] machineId=${machineId} ${deviceEndOk}${endOkRegister}=${preEnd.ok} still holds an END value before START (previous cycle). Writing RESET and waiting up to ${cfg.staleEndClearMs}ms for it to clear.`);
      let cleared = false;
      if (resetRegister !== null) {
        await write1(deviceReset, resetRegister, resetValue);
        const deadline = Date.now() + cfg.staleEndClearMs;
        do {
          await sleep(timing.pollIntervalMs);
          if (!(await readEnd()).isEnd) { cleared = true; break; }
        } while (Date.now() < deadline);
        await write1(deviceReset, resetRegister, 0);
      }
      mark(cleared ? "STALE_END_CLEARED" : "STALE_END_NOT_CLEARED");
      if (cleared) {
        console.log(`[PLC:STALE_END_CLEARED] machineId=${machineId} ${deviceEndOk}${endOkRegister} cleared after RESET`);
      } else {
        staleEnd = true;
        console.warn(`[PLC:STALE_END_SIGNAL] machineId=${machineId} ${deviceEndOk}${endOkRegister} did NOT clear${resetRegister === null ? " (no RESET register configured)" : ` within ${cfg.staleEndClearMs}ms after RESET`}. START continues; the END result is accepted only after the PLC clears the END register (stale value ignored).`);
      }
    }

    if (partRegister !== null) {
      const [phigh, plow] = split32To16(hashToRegisterValue(partId));
      await io.writeWords(socket, { device: devicePart, address: partRegister, values: [phigh, plow], timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS, frameMode });
    }
    if (stationRegister !== null) {
      const [shigh, slow] = split32To16(hashToRegisterValue(stationNo));
      await io.writeWords(socket, { device: deviceStation, address: stationRegister, values: [shigh, slow], timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS, frameMode });
    }

    // 1. START (the SLMP write response end code confirms the write)
    startWritten = true;
    startCommandActive = true;
    await write1(deviceStart, startRegister, startValue);
    startWrittenAt = Date.now();
    mark("START_WRITTEN");
    console.log(`[PLC:WRITE_SUCCESS] machineId=${machineId} register=${deviceStart}${startRegister} value=${startValue}`);

    // 2. RUNNING
    const startAccepted = endOnStatusRegister && !staleEnd ? [startedValue, endOkValue, endNgValue] : [startedValue];
    const runDeadline = Date.now() + timing.startAckTimeoutMs;
    let firstStatus;
    for (;;) {
      firstStatus = await read1(deviceStatus, statusRegister);
      if (startAccepted.includes(firstStatus)) break;
      if (Date.now() >= runDeadline) {
        throw new Error(`PLC SLMP START_ACK timeout (expected ${startAccepted.join(",")} on ${deviceStatus}${statusRegister}, last=${firstStatus})`);
      }
      await sleep(timing.pollIntervalMs);
    }
    mark(firstStatus === startedValue ? "RUNNING_DETECTED" : "END_ON_STATUS_DETECTED");
    const startAck = { type: "ACK_START", partId, protocol: "SLMP", value: firstStatus, frameMode };
    callHook("onRunning", startAck);

    if (firstStatus === startedValue) {
      // START held only as long as needed: clear once RUNNING is seen and the configured hold has elapsed.
      const heldMs = Date.now() - startWrittenAt;
      if (heldMs < timing.startHoldMs) await sleep(timing.startHoldMs - heldMs);
      await clearStart("RUNNING");
    }

    let finalStatus = firstStatus;
    let finalAckType = "ACK_END_OK";
    if (firstStatus === startedValue) {
      // 3. END (edge-armed when a stale END was left over)
      let armed = !staleEnd;
      let detected = false;
      const endDeadline = Date.now() + timing.endAckTimeoutMs;
      while (Date.now() < endDeadline) {
        const end = await readEnd();
        if (!armed) {
          if (!end.isEnd) {
            armed = true;
            console.log(`[PLC:STALE_END_CLEARED] machineId=${machineId} END register cleared by PLC during cycle — END detection armed`);
          }
        } else if (end.isOk) {
          finalStatus = endOkValue; finalAckType = "ACK_END_OK"; detected = true;
          break;
        } else if (end.isNg) {
          finalStatus = endNgValue; finalAckType = "ACK_END_NG"; detected = true;
          break;
        }
        await sleep(timing.pollIntervalMs);
      }
      if (!detected) {
        const err = new Error(armed
          ? `PLC SLMP end status timeout (expected OK:${endOkValue} or NG:${endNgValue} on ${deviceEndOk}${endOkRegister})`
          : `PLC SLMP end status timeout: STALE_END_SIGNAL — END register never cleared after START`);
        err.code = "CYCLE_TIMEOUT";
        throw err;
      }
    } else {
      finalAckType = firstStatus === endNgValue && firstStatus !== endOkValue ? "ACK_END_NG" : "ACK_END_OK";
    }
    mark(finalAckType === "ACK_END_OK" ? "END_OK_DETECTED" : "END_NG_DETECTED");
    console.log(`[PLC:${finalAckType === "ACK_END_OK" ? "END_OK" : "END_NG"}_DETECTED] machineId=${machineId} value=${finalStatus}`);

    // Data registers on the same socket, right after END (before RESET may clear them).
    let readings = null;
    const ranges = parseDataRanges(machine);
    if (ranges.length) {
      const readAt = Date.now();
      readings = { ranges: await readDataRanges((device, address, count) => readN(device, address, count), ranges), readMs: 0 };
      readings.readMs = Date.now() - readAt;
      mark("DATA_READ");
    }

    const endAck = { type: finalAckType, partId, protocol: "SLMP", value: finalStatus, frameMode, readings };
    callHook("onEnd", endAck, startAck);
    mark("RESULT_DELIVERED");

    // Optional Bin Acknowledgement for NG Parts
    if (finalAckType === "ACK_END_NG") {
      const bin = resolveBinAckConfig(machine);
      if (bin.enabled) {
        const ackDevice = resolveDevice(machine, "BIN_ACK");
        const binDeadline = Date.now() + timing.endAckTimeoutMs;
        let binAckReceived = false;
        while (Date.now() < binDeadline) {
          if ((await read1(ackDevice, bin.register)) === bin.value) { binAckReceived = true; break; }
          await sleep(timing.pollIntervalMs);
        }
        console.log(`[PLC:SLMP] BIN_ACK ${binAckReceived ? "received" : "timeout"} on register ${bin.register}`);
      }
    }

    // 4. RESET pulse + START clear (END already detected: failures here are warnings, not a comm error)
    let resetError = null;
    try {
      await clearStart("END");
      if (resetRegister !== null) {
        await write1(deviceReset, resetRegister, resetValue);
        mark("RESET_WRITTEN");
        await sleep(timing.signalHoldMs);
        await write1(deviceReset, resetRegister, 0);
        mark("RESET_CLEARED");
      }
    } catch (error) {
      resetError = String(error?.message || error);
      console.warn(`[PLC:RESET_FAILED] machineId=${machineId} END result kept (${finalAckType}); reset/START clear failed: ${resetError}`);
    }
    console.log(`[PLC:HANDSHAKE_TIMELINE] machineId=${machineId} ${marks.map((m) => `${m.step}@${m.atMs}ms`).join(" ")}`);

    return { ok: true, startAck, endAck, protocol: "SLMP", frameMode, staleEnd, resetError, timeline: marks };
  } catch (error) {
    // After START was written, the cycle must not be repeated (no frame-mode / service retry) — a retry would
    // re-trigger the machine. The operator rescans instead.
    if (startWritten) error.startWritten = true;
    error.timeline = marks;
    throw error;
  } finally {
    if (startCommandActive) {
      try { await write1(deviceStart, startRegister, 0); } catch (_error) { /* noop */ }
    }
  }
}

async function handshake({ ip, port, partId, stationNo, machine, hooks = {} }) {
  const timing = resolveTimingConfig(machine);
  const cfg = resolveHandshakeConfig(machine);
  if (!cfg.configured) {
    // Never START on D0: a machine without Start / Running registers is "PLC not configured".
    const err = createNotConfiguredError(machine);
    console.warn(`[PLC:NOT_CONFIGURED] machineId=${machine?.id} ${err.message}`);
    throw err;
  }

  const frameModes = orderFrameModes(getFrameModeCandidates(machine), ip, port);
  let lastError = null;
  for (const frameMode of frameModes) {
    try {
      const result = await withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, (socket) =>
        runHandshakeOnSocket(socket, { machine, partId, stationNo, frameMode, cfg, timing, hooks }));
      workingFrameMode.set(`${ip}:${port}`, frameMode);
      return result;
    } catch (error) {
      if (error?.startWritten) workingFrameMode.set(`${ip}:${port}`, frameMode); // the PLC answered in this mode
      lastError = error;
      if (error?.startWritten || error?.noRetry || !isRetryableSlmpAttemptError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("PLC packet timeout");
}

async function probe({ ip, port, machine, timeoutMs }) {
  const statusRegister = Number(machine?.plc_status_register);
  const deviceStatus = resolveDevice(machine, "STATUS");
  const frameModes = getFrameModeCandidates(machine);
  let lastError = null;
  for (const frameMode of frameModes) {
    try {
      return await withSocket({ ip, port, timeoutMs }, async (socket) => {
        if (Number.isFinite(statusRegister)) {
          const values = await readWords(socket, {
            device: deviceStatus,
            address: statusRegister,
            count: 1,
            timeoutMs: timeoutMs || DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
          return {
            protocol: "SLMP",
            connected: true,
            statusRegister,
            statusValue: values[0],
            frameMode,
          };
        }
        return { protocol: "SLMP", connected: true, frameMode };
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableSlmpAttemptError(error)) {
        throw error;
      }
    }
  }
  throw lastError || new Error("PLC packet timeout");
}

async function reset({ ip, port, machine }) {
  // Registers of 0 / empty are "not configured" (never write D0).
  const resolvedRegs = resolveHandshakeConfig(machine);
  const resetRegister = resolvedRegs.resetRegister ?? NaN;
  const startRegister = resolvedRegs.startRegister ?? NaN;
  const resetValue = Number(machine?.plc_reset_value ?? 9);

  const deviceReset = resolveDevice(machine, "RESET");
  const deviceStart = resolveDevice(machine, "TRIGGER");
  const frameModes = getFrameModeCandidates(machine);
  let lastError = null;
  for (const frameMode of frameModes) {
    try {
      return await withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
        if (Number.isFinite(resetRegister)) {
          await writeWords(socket, {
            device: deviceReset,
            address: resetRegister,
            values: [resetValue],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
          // RESET is a pulse (value → hold → 0), the same as at the end of the handshake. Leaving it at 1 kept the
          // machine in reset after every cycle, so the next START could be ignored.
          await sleep(Number(process.env.PLC_SIGNAL_HOLD_MS) > 0 ? Number(process.env.PLC_SIGNAL_HOLD_MS) : 700);
          await writeWords(socket, {
            device: deviceReset,
            address: resetRegister,
            values: [0],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
        if (Number.isFinite(startRegister)) {
          await writeWords(socket, {
            device: deviceStart,
            address: startRegister,
            values: [0],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
        return {
          protocol: "SLMP",
          connected: true,
          frameMode,
          resetRegister: Number.isFinite(resetRegister) ? resetRegister : null,
          resetValue: Number.isFinite(resetRegister) ? resetValue : null,
          startRegister: Number.isFinite(startRegister) ? startRegister : null,
          startValue: Number.isFinite(startRegister) ? 0 : null,
        };
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableSlmpAttemptError(error)) {
        throw error;
      }
    }
  }
  throw lastError || new Error("PLC packet timeout");
}

async function sendCommand({ ip, port, command, machine, partId, stationNo }) {
  const normalized = String(command || "").trim().toUpperCase();
  // Registers of 0 / empty are "not configured" (never write D0).
  const resolvedRegs = resolveHandshakeConfig(machine);
  const commandRegister = resolvedRegs.startRegister ?? NaN;
  const resetRegister = resolvedRegs.resetRegister ?? NaN;
  if (!Number.isFinite(commandRegister)) {
    console.log("[PLC:COMMAND] SLMP command register (plc_start_register) not configured. Bypassing command.");
    return {
      protocol: "SLMP",
      command: normalized,
      bypassed: true,
      message: "Command register not configured. Command bypassed.",
    };
  }

  const commandValue =
    normalized === "RESET_OPERATION"
      ? 0
      : normalized === "BLOCK_OPERATION"
        ? Number(machine?.plc_block_value ?? 2)
        : Number(machine?.plc_start_value ?? 1);

  const deviceCommand = resolveDevice(machine, "TRIGGER");
  const deviceReset = resolveDevice(machine, "RESET");
  const frameModes = getFrameModeCandidates(machine);
  let lastError = null;
  let usedFrameMode = null;
  for (const frameMode of frameModes) {
    try {
      await withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
        if (normalized === "START_OPERATION" && partId && Number.isFinite(machine?.plc_part_register)) {
          const hash32p = hashToRegisterValue(partId);
          const [phigh, plow] = split32To16(hash32p);
          const pBase = Number(machine.plc_part_register);
          console.log(`[PLC:SLMP] sendCommand PART_ID_HASH hash32=${hash32p} reg[${pBase}]=0x${phigh.toString(16)} reg[${pBase + 1}]=0x${plow.toString(16)}`);
          await writeWords(socket, {
            device: resolveDevice(machine, "PART_ID_HASH"),
            address: pBase,
            values: [phigh, plow],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
        if (normalized === "START_OPERATION" && stationNo && Number.isFinite(machine?.plc_station_register)) {
          const hash32s = hashToRegisterValue(stationNo);
          const [shigh, slow] = split32To16(hash32s);
          const sBase = Number(machine.plc_station_register);
          console.log(`[PLC:SLMP] sendCommand STATION_HASH hash32=${hash32s} reg[${sBase}]=0x${shigh.toString(16)} reg[${sBase + 1}]=0x${slow.toString(16)}`);
          await writeWords(socket, {
            device: resolveDevice(machine, "STATION_HASH"),
            address: sBase,
            values: [shigh, slow],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
        await writeWords(socket, {
          device: deviceCommand,
          address: commandRegister,
          values: [commandValue],
          timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
          frameMode,
        });
        if (normalized === "RESET_OPERATION" && Number.isFinite(resetRegister)) {
          const resetValue = Number(machine?.plc_reset_value ?? 9);
          await writeWords(socket, {
            device: deviceReset,
            address: resetRegister,
            values: [resetValue],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
      });
      usedFrameMode = frameMode;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!isRetryableSlmpAttemptError(error)) {
        throw error;
      }
    }
  }
  if (!usedFrameMode) {
    throw lastError || new Error("PLC packet timeout");
  }

  return {
    protocol: "SLMP",
    command: normalized,
    register: commandRegister,
    value: commandValue,
    frameMode: usedFrameMode,
  };
}

module.exports = {
  handshake,
  _runHandshakeOnSocket: runHandshakeOnSocket,
  _readDataRanges: readDataRanges,
  _parseDataRanges: parseDataRanges,
  _resolveTimingConfig: resolveTimingConfig,
  probe,
  reset,
  sendCommand,
};

