/* Leak tester PLC values (LeakTestReadings) for the Historical report, its Excel export and Component Journey.

   Source: one LeakTestReadings row per leak test, written when the PLC reports END OK / END NG
   (leakTestCaptureService.saveLeakReadingsAtEnd) — payload_json = { "<configured register name>": value, …,
   _meta: { source: "PLC_END", result, machineId, machineName, customerQr, endAt, ranges: [...] } }.
   Older rows without _meta.source === "PLC_END" were read at scan time, BEFORE the test ran, so their values
   belong to the previous cycle: they are ignored here.

   Columns: one per value register (device D, not BIT/BOOL) configured on the leak machines (Machine page →
   data register ranges). Identity = name lowercased with every non-alphanumeric removed ("Gall-1" = "Gall1" →
   "gall1"); label = the configured name (the spelling most leak machines use, ties → lowest machine id) plus
   " (unit)" when a unit is set. Nothing is hard-coded: renaming a register on the Machine page renames the column. */
const sequelize = require("../../config/db");

const normalizeLeakKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const BIT_DEVICES = new Set(["M", "X", "Y", "B", "L", "F", "V", "SM", "SB"]);
const isValueRange = (range = {}) => {
  const device = String(range.device || "D").trim().toUpperCase();
  const type = String(range.dataType || "").trim().toUpperCase();
  if (BIT_DEVICES.has(device) || type === "BIT" || type === "BOOL") return false;
  return Boolean(normalizeLeakKey(range.name));
};
const isLeakMachine = (m = {}) => {
  const op = String(m.operation_no || "").trim().toUpperCase();
  return op === "OP150" || String(m.machine_name || "").toUpperCase().includes("LEAK");
};
const parseJson = (v, fallback) => {
  if (v && typeof v === "object") return v;
  try { return v ? JSON.parse(v) : fallback; } catch (_e) { return fallback; }
};

/* Build the column list from [{ machineId, ranges }] (machines in id order). */
function columnsFromRanges(machineRanges = []) {
  const byKey = new Map();
  machineRanges.forEach(({ machineId, ranges }) => {
    (Array.isArray(ranges) ? ranges : []).filter(isValueRange).forEach((r) => {
      const key = normalizeLeakKey(r.name);
      const name = String(r.name).trim();
      if (!byKey.has(key)) byKey.set(key, { key, order: byKey.size, names: new Map(), unit: "" });
      const col = byKey.get(key);
      const seen = col.names.get(name) || { count: 0, firstMachine: Number(machineId) || 0 };
      seen.count += 1;
      col.names.set(name, seen);
      if (!col.unit && String(r.unit || "").trim()) col.unit = String(r.unit).trim();
    });
  });
  return [...byKey.values()].sort((a, b) => a.order - b.order).map((col) => {
    const [name] = [...col.names.entries()].sort((a, b) => (b[1].count - a[1].count) || (a[1].firstMachine - b[1].firstMachine))[0];
    return { key: col.key, name, unit: col.unit, label: col.unit ? `${name} (${col.unit})` : name };
  });
}

let columnsCache = { at: 0, value: null };
const COLUMNS_TTL_MS = 60 * 1000;
/** Configured leak-machine value registers → [{ key, name, unit, label }] (cached for a minute). */
async function getLeakPlcColumns() {
  if (columnsCache.value && Date.now() - columnsCache.at < COLUMNS_TTL_MS) return columnsCache.value;
  const machines = await sequelize.query(
    "SELECT id, machine_name, operation_no, plc_registers FROM Machines ORDER BY id ASC",
    { type: sequelize.QueryTypes.SELECT },
  );
  const value = columnsFromRanges(machines.filter(isLeakMachine).map((m) => ({
    machineId: m.id,
    ranges: parseJson(m.plc_registers, {})?.dataRegisterRanges,
  })));
  columnsCache = { at: Date.now(), value };
  return value;
}

/* Columns plus any value register found in the readings themselves (a register renamed / removed on the Machine
   page after the test) so a stored value is never silently dropped. */
function withReadingColumns(columns = [], readings = []) {
  const known = new Set(columns.map((c) => c.key));
  const extra = [];
  readings.forEach((rd) => {
    (rd?.ranges || []).forEach((r) => {
      const key = normalizeLeakKey(r.name);
      if (!key || known.has(key) || !isValueRange(r)) return;
      known.add(key);
      const name = String(r.name).trim();
      const unit = String(r.unit || "").trim();
      extra.push({ key, name, unit, label: unit ? `${name} (${unit})` : name });
    });
  });
  return extra.length ? [...columns, ...extra] : columns;
}

const roundValue = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return v ?? null;
  return Number.isInteger(v) ? v : Number(v.toPrecision(6)); // REAL32 → drop float noise (0.12300000339 → 0.123)
};

/* One stored row → compact reading for the client, or null for a legacy (scan-time) row. */
function toReading(row) {
  const payload = parseJson(row?.payload_json, null);
  const meta = payload?._meta;
  if (!payload || !meta || meta.source !== "PLC_END") return null;
  const values = {};
  Object.entries(payload).forEach(([name, value]) => {
    if (name === "_meta" || name.endsWith("__error")) return;
    const key = normalizeLeakKey(name);
    if (key && !(key in values)) values[key] = roundValue(value);
  });
  const endAt = meta.endAt || (row.createdAt ? new Date(row.createdAt).toISOString() : null);
  return {
    machineId: meta.machineId ?? row.machine_id ?? null,
    machineName: meta.machineName || null,
    result: meta.result || null,
    endAt,
    customerQr: meta.customerQr || null,
    values,
    ranges: Array.isArray(meta.ranges) ? meta.ranges.map((r) => ({ name: r.name, unit: r.unit || "", device: r.device, dataType: r.dataType })) : [],
    _t: new Date(endAt || 0).getTime() || 0,
    _id: Number(row.id) || 0,
  };
}
const later = (a, b) => (!a ? b : !b ? a : (b._t > a._t || (b._t === a._t && b._id > a._id)) ? b : a);
const strip = (rd) => { if (!rd) return null; const { _t, _id, ...rest } = rd; void _t; void _id; return rest; };

/* Latest PLC_END reading per lookup key (part ID or customer QR), plus every reading per key (oldest first).
   One query per 1000 keys — never one per row. */
async function loadReadingsByKeys(keys = []) {
  const list = [...new Set(keys.map((k) => String(k || "").trim()).filter((k) => k && k !== "-"))];
  const latest = new Map();
  const all = new Map();
  for (let i = 0; i < list.length; i += 1000) {
    const rows = await sequelize.query(
      `SELECT id, part_id, machine_id, payload_json, createdAt FROM LeakTestReadings
       WHERE part_id IN (:keys) AND payload_json LIKE '%"PLC_END"%'`,
      { replacements: { keys: list.slice(i, i + 1000) }, type: sequelize.QueryTypes.SELECT },
    );
    rows.forEach((row) => {
      const rd = toReading(row);
      if (!rd) return;
      [String(row.part_id || "").trim(), String(rd.customerQr || "").trim()].filter(Boolean).forEach((k) => {
        latest.set(k, later(latest.get(k), rd));
        if (!all.has(k)) all.set(k, []);
        if (!all.get(k).includes(rd)) all.get(k).push(rd);
      });
    });
  }
  all.forEach((arr) => arr.sort((a, b) => (a._t - b._t) || (a._id - b._id)));
  return { latest, all };
}

/** Decisive (latest) PLC_END reading per ProductionReport row → Map(report.id → reading). */
async function loadLeakPlcForReports(reports = []) {
  const out = new Map();
  if (!reports.length) return out;
  const { latest } = await loadReadingsByKeys(reports.flatMap((r) => [r.part_id, r.customer_qr]));
  reports.forEach((rep) => {
    const rd = later(latest.get(String(rep.part_id || "").trim()), latest.get(String(rep.customer_qr || "").trim()));
    if (rd) out.set(rep.id, strip(rd));
  });
  return out;
}

/** Every PLC_END reading of one part (any of its codes), oldest first — Component Journey. */
async function loadLeakPlcForPart(codes = []) {
  const { all } = await loadReadingsByKeys(codes);
  const merged = [];
  all.forEach((arr) => arr.forEach((rd) => { if (!merged.includes(rd)) merged.push(rd); }));
  merged.sort((a, b) => (a._t - b._t) || (a._id - b._id));
  return merged.map(strip);
}

module.exports = {
  normalizeLeakKey,
  isValueRange,
  columnsFromRanges,
  getLeakPlcColumns,
  withReadingColumns,
  toReading,
  loadLeakPlcForReports,
  loadLeakPlcForPart,
};
