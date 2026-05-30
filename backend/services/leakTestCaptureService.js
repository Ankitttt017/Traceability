const Machine = require("../models/Machine");
const LeakTestReading = require("../models/LeakTestReading");
const { readModbusRegisters, readSlmpRegisters } = require("./plcIoService");

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseMachineRanges(machine) {
  try {
    const parsed = typeof machine?.plc_registers === "string" ? JSON.parse(machine.plc_registers) : (machine?.plc_registers || {});
    return Array.isArray(parsed?.dataRegisterRanges) ? parsed.dataRegisterRanges : [];
  } catch (_e) {
    return [];
  }
}

function decodeWords(words, type) {
  const mode = String(type || "INT16").toUpperCase();
  if (!Array.isArray(words) || words.length === 0) return null;
  if (mode === "ASCII" || mode === "ALPHANUM") {
    let out = "";
    for (const raw of words) {
      const v = Number(raw || 0) & 0xffff;
      const lo = v & 0xff;
      const hi = (v >> 8) & 0xff;
      if (lo >= 32 && lo <= 126) out += String.fromCharCode(lo);
      if (hi >= 32 && hi <= 126) out += String.fromCharCode(hi);
    }
    return mode === "ALPHANUM" ? out.replace(/[^A-Za-z0-9\-_.:/]/g, "") : out;
  }
  if (mode === "REAL32BIT" || mode === "FLOAT32") {
    if (words.length < 2) return null;
    const b = Buffer.allocUnsafe(4);
    b.writeUInt16LE(Number(words[0] || 0) & 0xffff, 0);
    b.writeUInt16LE(Number(words[1] || 0) & 0xffff, 2);
    return b.readFloatLE(0);
  }
  if (mode === "BIT" || mode === "BOOL") return Number(words[0] || 0) > 0 ? 1 : 0;
  if (mode === "DEC") return Number(words[0] || 0);
  return words.length === 1 ? Number(words[0] || 0) : words.map((v) => Number(v || 0));
}

async function captureLeakReadingsForScan({ machineId, partId, stationNo, operationLogId }) {
  const machine = await Machine.findByPk(machineId);
  if (!machine) return null;
  const ranges = parseMachineRanges(machine);
  if (!ranges.length) return null;

  const protocol = String(machine.plc_protocol || "TCP_TEXT").toUpperCase();
  const ip = machine.plc_ip || machine.machine_ip;
  const port = toNum(machine.plc_port || machine.machine_port);
  if (!ip || !port || !["SLMP", "MODBUS_TCP"].includes(protocol)) return null;

  const payload = {};
  for (const row of ranges) {
    const name = String(row?.name || `REG_${row?.startReg || ""}`).trim();
    const device = String(row?.device || "D").toUpperCase();
    const start = toNum(row?.startReg);
    const count = Math.max(1, toNum(row?.count, 1));
    if (!name || start === null) continue;
    const regs = Array.from({ length: count }, (_, i) => start + i);
    try {
      let values = {};
      if (protocol === "SLMP") {
        const res = await readSlmpRegisters({
          ip,
          port,
          registers: regs.map((register) => ({ register, device })),
          timeoutMs: toNum(machine.plc_test_timeout_ms, 8000),
          defaultDevice: device,
          frameMode: String(row?.frameMode || machine.plc_slmp_frame_mode || "AUTO").toUpperCase(),
        });
        values = res?.values || {};
      } else {
        const res = await readModbusRegisters({
          ip,
          port,
          unitId: toNum(machine.plc_unit_id, 1),
          registers: regs,
          timeoutMs: toNum(machine.plc_test_timeout_ms, 8000),
        });
        values = res?.values || {};
      }
      const words = regs.map((r) => (Object.prototype.hasOwnProperty.call(values, r) ? values[r] : 0));
      payload[name] = decodeWords(words, row?.dataType);
    } catch (err) {
      payload[name] = null;
      payload[`${name}__error`] = String(err?.message || "READ_FAILED");
    }
  }

  const created = await LeakTestReading.create({
    part_id: String(partId || "").trim(),
    machine_id: Number(machineId),
    station_no: String(stationNo || "").trim() || null,
    operation_log_id: toNum(operationLogId),
    payload_json: JSON.stringify(payload),
  });
  return created;
}

module.exports = { captureLeakReadingsForScan };

