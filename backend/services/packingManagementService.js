const PackingManagementSetting = require("../models/PackingManagementSetting");
const PackingSession = require("../models/PackingSession");

const MIN_CAPACITY = 1;
const MAX_CAPACITY = 500;
const MIN_PADDING = 1;
const MAX_PADDING = 10;
const DEFAULTS = {
  config_key: "DEFAULT",
  box_prefix: "BOX",
  box_separator: "-",
  serial_padding: 4,
  next_serial: 1,
  default_capacity: 65,
  auto_create_next_box: true,
  label_prefix: "PKG",
};

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function normalizePrefix(value, fallback) {
  const normalized = String(value || fallback || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  return normalized || fallback;
}

function normalizeSeparator(value, fallback = "-") {
  const normalized = String(value ?? fallback).slice(0, 3);
  return normalized;
}

function mapRowToSettings(row) {
  return {
    id: row.id,
    boxPrefix: row.box_prefix,
    boxSeparator: row.box_separator,
    serialPadding: row.serial_padding,
    nextSerial: row.next_serial,
    defaultCapacity: row.default_capacity,
    autoCreateNextBox: row.auto_create_next_box !== false,
    labelPrefix: row.label_prefix,
    preview: formatBoxNumber(
      {
        boxPrefix: row.box_prefix,
        boxSeparator: row.box_separator,
        serialPadding: row.serial_padding,
      },
      row.next_serial
    ),
  };
}

function formatBoxNumber(settings, serialNo) {
  const prefix = normalizePrefix(settings.boxPrefix, "BOX");
  const separator = normalizeSeparator(settings.boxSeparator, "-");
  const padding = Math.min(MAX_PADDING, Math.max(MIN_PADDING, toPositiveInt(settings.serialPadding, 4)));
  const serial = String(Math.max(1, toPositiveInt(serialNo, 1))).padStart(padding, "0");
  return `${prefix}${separator}${serial}`;
}

async function ensureSettingsRow() {
  let row = await PackingManagementSetting.findOne({
    where: { config_key: DEFAULTS.config_key },
  });

  if (!row) {
    row = await PackingManagementSetting.create({ ...DEFAULTS });
  }

  return row;
}

async function getPackingManagementSettings() {
  const row = await ensureSettingsRow();
  return mapRowToSettings(row);
}

async function updatePackingManagementSettings(payload = {}, userId = null) {
  const row = await ensureSettingsRow();

  row.box_prefix = normalizePrefix(payload.boxPrefix ?? row.box_prefix, row.box_prefix);
  row.box_separator = normalizeSeparator(payload.boxSeparator ?? row.box_separator, row.box_separator);
  row.serial_padding = Math.min(
    MAX_PADDING,
    Math.max(MIN_PADDING, toPositiveInt(payload.serialPadding ?? row.serial_padding, row.serial_padding))
  );
  row.next_serial = Math.max(1, toPositiveInt(payload.nextSerial ?? row.next_serial, row.next_serial));
  row.default_capacity = Math.min(
    MAX_CAPACITY,
    Math.max(MIN_CAPACITY, toPositiveInt(payload.defaultCapacity ?? row.default_capacity, row.default_capacity))
  );
  row.auto_create_next_box =
    payload.autoCreateNextBox === undefined ? row.auto_create_next_box !== false : payload.autoCreateNextBox === true;
  row.label_prefix = normalizePrefix(payload.labelPrefix ?? row.label_prefix, row.label_prefix || "PKG");
  row.updated_by = userId || null;
  await row.save();

  return mapRowToSettings(row);
}

async function isBoxNumberUsed(boxNumber) {
  const existing = await PackingSession.findOne({
    where: { box_number: String(boxNumber || "").trim().toUpperCase() },
    attributes: ["id"],
  });
  return Boolean(existing);
}

async function reserveNextAutoBox() {
  const row = await ensureSettingsRow();
  let serial = Math.max(1, toPositiveInt(row.next_serial, 1));

  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const boxNumber = formatBoxNumber(
      {
        boxPrefix: row.box_prefix,
        boxSeparator: row.box_separator,
        serialPadding: row.serial_padding,
      },
      serial
    );

    // Ensure generated serial does not collide with historical/manual box numbers.
    // This allows serial to move forward safely even after config changes.
    // eslint-disable-next-line no-await-in-loop
    const used = await isBoxNumberUsed(boxNumber);
    if (!used) {
      row.next_serial = serial + 1;
      await row.save();
      return {
        boxNumber,
        serialNo: serial,
        defaultCapacity: row.default_capacity,
        autoCreateNextBox: row.auto_create_next_box !== false,
        labelPrefix: row.label_prefix,
      };
    }
    serial += 1;
  }

  throw new Error("Unable to reserve next auto-generated box number");
}

async function listPackingBoxes({ status, limit = 200, offset = 0 } = {}) {
  const where = {};
  const normalizedStatus = String(status || "")
    .trim()
    .toUpperCase();
  if (normalizedStatus === "OPEN" || normalizedStatus === "CLOSED") {
    where.status = normalizedStatus;
  }

  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 1000) : 200;
  const parsedOffset = Number(offset);
  const safeOffset = Number.isFinite(parsedOffset) ? Math.max(0, Math.trunc(parsedOffset)) : 0;

  const rows = await PackingSession.findAll({
    where,
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
    limit: safeLimit,
    offset: safeOffset,
  });

  const total = await PackingSession.count({ where });

  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      serialNo: row.serial_no,
      boxNumber: row.box_number,
      capacity: row.capacity,
      packedCount: row.packed_count,
      status: row.status,
      labelCode: row.label_code || null,
      generationSource: row.generation_source || "AUTO",
      createdAt: row.createdAt,
      closedAt: row.closed_at || null,
    })),
  };
}

module.exports = {
  formatBoxNumber,
  getPackingManagementSettings,
  updatePackingManagementSettings,
  reserveNextAutoBox,
  listPackingBoxes,
};
