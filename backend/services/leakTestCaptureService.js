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

/** Column identity across machines: "Gall-1", "Gall1", "gall 1" → "gall1" (label stays the configured name). */
function normalizeReadingKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BIT_DEVICES = new Set(["M", "X", "Y", "B", "L", "F", "V"]);

function decodeRangeWords(range = {}) {
  if (!Array.isArray(range.words) || range.words.length === 0) return null;
  const type = String(range.dataType || "INT16").toUpperCase();
  // A word read on a bit device (M190) packs 16 bits; the configured bit is the lowest one.
  if (BIT_DEVICES.has(String(range.device || "").toUpperCase()) || type === "BIT" || type === "BOOL") {
    return (Number(range.words[0] || 0) & 1) ? 1 : 0;
  }
  const value = decodeWords(range.words, type);
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

/**
 * Store the data registers read on the PLC handshake socket right after END OK / END NG
 * (plcHandshakeEngine → slmpService). One LeakTestReadings row per test, keyed by the part ID; the mapped
 * customer QR, machine, station, operation log, END result and the configured register names are kept in
 * payload_json._meta (no schema change). Payload keys are the configured names from the Machine page.
 */
async function saveLeakReadingsAtEnd({ machine, partId, stationNo, operationLogId, result, readings }) {
  const normalizedPartId = String(partId || "").trim();
  const ranges = Array.isArray(readings?.ranges) ? readings.ranges : [];
  if (!normalizedPartId || !machine?.id || ranges.length === 0) return null;

  const payload = {};
  for (const range of ranges) {
    const name = String(range.name || "").trim();
    if (!name) continue;
    payload[name] = range.error ? null : decodeRangeWords(range);
    if (range.error) payload[`${name}__error`] = range.error;
  }

  // The leak station may be scanned with the part ID (DPM) or with the mapped customer QR: keep both.
  let customerQr = null;
  let storedPartId = normalizedPartId;
  try {
    const PartCodeMapping = require("../models/PartCodeMapping");
    const { Op } = require("sequelize");
    const mapping = await PartCodeMapping.findOne({
      where: { is_active: true, [Op.or]: [{ old_part_id: normalizedPartId }, { customer_qr: normalizedPartId }] },
      attributes: ["old_part_id", "customer_qr"],
      order: [["id", "DESC"]],
    });
    if (mapping?.old_part_id && mapping.old_part_id !== mapping.customer_qr) {
      storedPartId = String(mapping.old_part_id).trim() || normalizedPartId;
      customerQr = mapping.customer_qr || null;
    }
  } catch (_error) {
    customerQr = null;
  }

  payload._meta = {
    source: "PLC_END",
    result: String(result || "").toUpperCase() || null,
    machineId: Number(machine.id),
    machineName: machine.machine_name || null,
    stationNo: String(stationNo || machine.operation_no || "").trim().toUpperCase() || null,
    operationLogId: toNum(operationLogId),
    customerQr,
    scannedCode: normalizedPartId,
    endAt: new Date().toISOString(),
    readMs: toNum(readings?.readMs),
    ranges: ranges.map((range) => ({
      name: range.name,
      key: normalizeReadingKey(range.name),
      unit: range.unit || "",
      device: range.device,
      startReg: range.startReg,
      count: range.count,
      dataType: range.dataType,
    })),
  };

  return LeakTestReading.create({
    part_id: storedPartId,
    machine_id: Number(machine.id),
    station_no: payload._meta.stationNo,
    operation_log_id: payload._meta.operationLogId,
    payload_json: JSON.stringify(payload),
  });
}

module.exports = { captureLeakReadingsForScan, saveLeakReadingsAtEnd, normalizeReadingKey, decodeRangeWords, decodeWords };

