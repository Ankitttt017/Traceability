// OP150 leak tester handshake / station override / PLC error rules (no network, no DB writes).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { resolveHandshakeConfig, getHandshakeConfigIssue } = require("../services/plcHandshakeConfig");
const slmp = require("../services/plcProtocols/slmpService");
const { applyMachineOverride, normalizeMachineOverrides, isMachineOverrideBypassed } = require("../services/stationFeatureService");
const { decodeRangeWords, normalizeReadingKey } = require("../services/leakTestCaptureService");

const ranges = [
  { name: "Leak Rate", device: "D", startReg: 2258, endReg: 2259, count: 2, dataType: "REAL32BIT" },
  { name: "Gall-1", device: "D", startReg: 2254, endReg: 2255, count: 2, dataType: "REAL32BIT" },
  { name: "Gall-2", device: "D", startReg: 2256, endReg: 2257, count: 2, dataType: "REAL32BIT" },
  { name: "Dry", device: "M", startReg: 190, endReg: 190, count: 1, dataType: "BIT" },
];
const regs = (startedValue) => JSON.stringify({
  startRegister: 360, statusRegister: 361, runningRegister: 361, blockRegister: 360, endOkRegister: 362, endNgRegister: 362,
  resetRegister: 363, bypassRegister: 364, startValue: 1, startedValue, endOkValue: 1, endNgValue: 2, blockValue: 2, resetValue: 1,
  dataRegisterRanges: ranges,
});
// Columns as stored in Machines (SELECT on 2026-10-10): END registers only in plc_registers JSON.
const LT1 = { id: 6, machine_name: "Leak-Test-01", plc_protocol: "SLMP", plc_start_register: 360, plc_status_register: 361, plc_reset_register: 363, plc_block_register: 360, plc_end_ok_register: null, plc_end_ng_register: null, plc_bypass_register: null, plc_start_value: 1, plc_started_value: 1, plc_end_ok_value: 1, plc_end_ng_value: 2, plc_block_value: 2, plc_reset_value: 1, plc_bypass_value: 1, start_hold_ms: 500, plc_registers: regs(1) };
const LT2 = { ...LT1, id: 7, machine_name: "Leak-Test-02", plc_started_value: 2, plc_registers: regs(2) };
const LT3 = { id: 8, machine_name: "Leak Test-03", plc_protocol: "SLMP", plc_start_register: 0, plc_status_register: 0, plc_reset_register: 0, plc_block_register: 0, plc_start_value: 1, plc_started_value: 2, plc_end_ok_value: 3, plc_end_ng_value: 4, plc_reset_value: 9, plc_registers: JSON.stringify({ startRegister: 0, statusRegister: 0, endOkRegister: 0, endNgRegister: 0, resetRegister: 0, bypassRegister: 0 }) };

function floatWords(value) {
  const b = Buffer.alloc(4); b.writeFloatLE(value, 0);
  return [b.readUInt16LE(0), b.readUInt16LE(2)];
}

/** Fake leak-tester PLC: START → RUNNING after runAfterMs → END after testMs; RESET clears END. */
function fakePlc({ runningValue, endValue = 1, runAfterMs = 30, testMs = 60, staleEnd = null, resetClearsEnd = true, clearEndOnStart = false }) {
  const mem = { D: new Map(), M: new Map() };
  const log = [];
  const t0 = Date.now();
  const set = (dev, addr, v) => mem[dev].set(addr, v);
  const get = (dev, addr) => mem[dev].get(addr) || 0;
  if (staleEnd !== null) set("D", 362, staleEnd);
  [[2254, 1.5], [2256, 2.25], [2258, 0.125]].forEach(([a, v]) => { const [lo, hi] = floatWords(v); set("D", a, lo); set("D", a + 1, hi); });
  set("M", 190, 1);
  const later = (fn, ms) => setTimeout(fn, ms).unref();
  const io = {
    readWords: async (_s, { device, address, count }) => Array.from({ length: count }, (_, i) => get(device, address + i)),
    writeWords: async (_s, { device, address, values }) => {
      log.push({ at: Date.now() - t0, op: `W ${device}${address}=${values.join(",")}` });
      values.forEach((v, i) => set(device, address + i, v));
      if (device === "D" && address === 360 && values[0] === 1) {
        if (clearEndOnStart) later(() => set("D", 362, 0), 5);
        later(() => set("D", 361, runningValue), runAfterMs);
        later(() => { set("D", 361, 0); set("D", 362, endValue); }, runAfterMs + testMs);
      }
      if (device === "D" && address === 363 && values[0] === 1 && resetClearsEnd) later(() => set("D", 362, 0), 5);
    },
  };
  return { io, log, get };
}

const timing = { signalHoldMs: 20, pollIntervalMs: 5, startAckTimeoutMs: 500, endAckTimeoutMs: 1000, startHoldMs: 10 };
const run = (machine, plc, cfgPatch = {}, hooks = {}) => slmp._runHandshakeOnSocket({}, {
  machine, partId: "1234567890123", stationNo: "OP150", frameMode: "BINARY",
  cfg: { ...resolveHandshakeConfig(machine), staleEndClearMs: 100, ...cfgPatch }, timing, io: plc.io, hooks,
});

test("effective I/O config of LT-1 / LT-2 follows the Machine page (END from plc_registers JSON)", () => {
  const c1 = resolveHandshakeConfig(LT1);
  assert.deepEqual(
    [c1.startRegister, c1.startValue, c1.blockRegister, c1.blockValue, c1.statusRegister, c1.startedValue, c1.endOkRegister, c1.endOkValue, c1.endNgRegister, c1.endNgValue, c1.resetRegister, c1.resetValue, c1.bypassRegister, c1.bypassValue],
    [360, 1, 360, 2, 361, 1, 362, 1, 362, 2, 363, 1, 364, 1],
  );
  assert.equal(resolveHandshakeConfig(LT2).startedValue, 2);
  assert.equal(getHandshakeConfigIssue(LT1), null);
});

test("LT-3 with registers 0 is PLC not configured and handshake never opens a socket / writes D0", async () => {
  const cfg = resolveHandshakeConfig(LT3);
  assert.equal(cfg.configured, false);
  assert.deepEqual(cfg.missing, ["START", "RUNNING/STATUS"]);
  assert.match(getHandshakeConfigIssue(LT3), /PLC not configured for Leak Test-03/);
  await assert.rejects(slmp.handshake({ ip: "127.0.0.1", port: 1, partId: "X", stationNo: "OP150", machine: LT3 }),
    (err) => err.code === "PLC_NOT_CONFIGURED" && err.noRetry === true);
});

for (const [machine, runningValue] of [[LT1, 1], [LT2, 2]]) {
  test(`${machine.machine_name}: START D360=1, RUNNING D361=${runningValue}, END OK D362=1, RESET D363=1→0, START cleared`, async () => {
    const plc = fakePlc({ runningValue });
    const events = [];
    const result = await run(machine, plc, {}, {
      onRunning: (ack) => events.push(["RUNNING", ack.value]),
      onEnd: (ack) => events.push(["END", ack.type]),
    });
    assert.equal(result.endAck.type, "ACK_END_OK");
    assert.equal(result.startAck.value, runningValue);
    const ops = plc.log.map((l) => l.op);
    assert.deepEqual(ops, ["W D360=1", "W D360=0", "W D363=1", "W D363=0"]);
    assert.deepEqual(events, [["RUNNING", runningValue], ["END", "ACK_END_OK"]]);
    // data registers read on the same socket right after END
    const byName = Object.fromEntries(result.endAck.readings.ranges.map((r) => [r.name, decodeRangeWords(r)]));
    assert.equal(byName["Gall-1"], 1.5);
    assert.equal(byName["Gall-2"], 2.25);
    assert.equal(byName["Leak Rate"], 0.125);
    assert.equal(byName.Dry, 1);
  });
}

test("END NG (D362=2) is reported as ACK_END_NG", async () => {
  const result = await run(LT1, fakePlc({ runningValue: 1, endValue: 2 }));
  assert.equal(result.endAck.type, "ACK_END_NG");
});

test("LT-1 Running=1 equals End OK=1 on another register: not taken as END while D362 is clear", async () => {
  const plc = fakePlc({ runningValue: 1, testMs: 80 });
  const result = await run(LT1, plc);
  // RUNNING (D361=1) was seen first; END only when D362 became 1
  assert.equal(result.startAck.value, 1);
  const end = result.timeline.find((m) => m.step === "END_OK_DETECTED");
  const running = result.timeline.find((m) => m.step === "RUNNING_DETECTED");
  assert.ok(end.atMs - running.atMs >= 60, `END after the test time (${end.atMs - running.atMs}ms)`);
});

test("stale END before START: RESET written, cleared, then normal cycle", async () => {
  const plc = fakePlc({ runningValue: 1, staleEnd: 1 });
  const result = await run(LT1, plc);
  assert.equal(result.staleEnd, false);
  assert.deepEqual(plc.log.map((l) => l.op).slice(0, 3), ["W D363=1", "W D363=0", "W D360=1"]);
  assert.equal(result.endAck.type, "ACK_END_OK");
});

test("stale END that does not clear: STALE_END_SIGNAL, stale value ignored until the PLC clears it (edge)", async () => {
  // Stale NG (2) stays after RESET; the PLC clears it only when the new cycle starts, then ends OK.
  const plc = fakePlc({ runningValue: 1, staleEnd: 2, resetClearsEnd: false, clearEndOnStart: true, testMs: 60 });
  const result = await run(LT1, plc);
  assert.equal(result.staleEnd, true);
  assert.equal(result.endAck.type, "ACK_END_OK", "stale NG must not be taken as this part's result");
});

test("stale END never cleared: cycle times out (PLC error), never a false OK/NG", async () => {
  const plc = fakePlc({ runningValue: 1, staleEnd: 1, resetClearsEnd: false, testMs: 10_000 });
  await assert.rejects(run(LT1, plc), (err) => err.code === "CYCLE_TIMEOUT" && /STALE_END_SIGNAL/.test(err.message) && err.startWritten === true);
  assert.equal(plc.get("D", 360), 0, "START cleared on failure");
});

test("RUNNING never comes: START_ACK timeout, START cleared, error flagged startWritten (no retry)", async () => {
  const plc = fakePlc({ runningValue: 1, runAfterMs: 100_000 });
  await assert.rejects(run(LT1, plc, {}, {}), (err) => /START_ACK timeout/.test(err.message) && err.startWritten === true);
  assert.equal(plc.get("D", 360), 0);
});

test("data ranges: contiguous D2254..D2259 read in one request", async () => {
  const calls = [];
  const out = await slmp._readDataRanges(async (device, address, count) => { calls.push(`${device}${address}x${count}`); return Array(count).fill(0); },
    slmp._parseDataRanges({ plc_registers: regs(1) }));
  assert.deepEqual(calls.sort(), ["D2254x6", "M190x1"]);
  assert.equal(out.length, 4);
  assert.equal(normalizeReadingKey("Gall-1"), normalizeReadingKey("Gall1"));
});

test("plcCommunicationService: no retry after START, no circuit failure for PLC not configured", async () => {
  const plcService = require("../services/plcCommunicationService");
  const realSlmp = plcService.PROTOCOLS.SLMP;
  let calls = 0;
  try {
    plcService.PROTOCOLS.SLMP = { handshake: async () => { calls += 1; const e = new Error("PLC SLMP START_ACK timeout"); e.startWritten = true; throw e; } };
    let failures = 0;
    const r1 = await plcService.executePlcHandshake({ ip: "10.0.0.1", port: 1, machineId: 9901, machine: { plc_protocol: "SLMP" }, onFailure: async () => { failures += 1; } });
    assert.equal(r1.ok, false); assert.equal(calls, 1); assert.equal(failures, 1);

    calls = 0;
    plcService.PROTOCOLS.SLMP = { handshake: async () => { calls += 1; const e = new Error("PLC not configured"); e.code = "PLC_NOT_CONFIGURED"; e.noRetry = true; throw e; } };
    await plcService.executePlcHandshake({ ip: "10.0.0.1", port: 1, machineId: 9902, machine: { plc_protocol: "SLMP" } });
    assert.equal(calls, 1);
    assert.equal(plcService.getCircuitState("machine:9902").consecutiveFailures, 0);

    calls = 0;
    plcService.PROTOCOLS.SLMP = { handshake: async () => { calls += 1; throw new Error("PLC packet timeout"); } };
    const r3 = await plcService.executePlcHandshake({ ip: "10.0.0.1", port: 1, machineId: 9903, machine: { plc_protocol: "SLMP" } });
    assert.equal(r3.ok, false); assert.equal(calls, plcService.DEFAULT_RETRIES, "transport failure before START is retried");
  } finally {
    plcService.PROTOCOLS.SLMP = realSlmp;
  }
});

test("station settings: machine override wins, station value inherited otherwise", () => {
  const station = { qr: true, operation: true, plcCommunication: true, bypass: false };
  const overrides = normalizeMachineOverrides({ 8: { plcCommunication: false, junk: 1 }, abc: { qr: false }, 7: {} });
  assert.deepEqual(overrides, { 8: { plcCommunication: false } });
  assert.equal(applyMachineOverride(station, overrides, 8).plcCommunication, false);
  assert.equal(applyMachineOverride(station, overrides, 6).plcCommunication, true);
  assert.equal(applyMachineOverride(station, overrides, 6).machineOverride, false);
  assert.equal(isMachineOverrideBypassed({ 7: { bypass: true } }, 7), true);
  assert.equal(isMachineOverrideBypassed({ 7: { operation: false } }, 7), true);
  assert.equal(isMachineOverrideBypassed(overrides, 8), false);
});

test("operator popups are machine scoped (OP150 LT-1 event never shows on LT-2)", async () => {
  const { isPopupForMachine } = await import(pathToFileURL(path.join(__dirname, "../../frontend/src/utils/popupScope.js")).href);
  const lt2 = { machineId: "7", stationNo: "OP150", stationReady: true };
  assert.equal(isPopupForMachine({ machineId: 6, stationNo: "OP150", partId: "P" }, lt2), false);
  assert.equal(isPopupForMachine({ machine_id: "7", stationNo: "OP150" }, lt2), true);
  assert.equal(isPopupForMachine({ machineId: 7 }, lt2), true);
  // fallback only without machineId
  assert.equal(isPopupForMachine({ stationNo: "OP150", status: "STATION_RESET" }, lt2), true);
  assert.equal(isPopupForMachine({ stationNo: "OP140" }, lt2), false);
  assert.equal(isPopupForMachine({ stationNo: "OP150" }, { ...lt2, stationReady: false }), false);
  assert.equal(isPopupForMachine({}, lt2), false);
});

// Models pull in the Sequelize pool; close it so the test process exits promptly (no queries are made).
test.after(async () => {
  try { await require("../config/db").close(); } catch (_error) { /* not opened */ }
});
