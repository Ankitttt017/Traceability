const StationFeatureSetting = require("../models/StationFeatureSetting");
const { Op } = require("sequelize");

const DEFAULT_FEATURES = {
  qr: true,
  operation: true,
  plcCommunication: true,
  bypass: false,
  rejectionBin: true,
  rejectionCategoryCR: true,
  rejectionCategoryCRAM: true,
  rejectionCategoryMR: true,
  manualResult: false,
  plcPartCount: 1,
  validateQrFormat: true,
  validateShotNumber: false,
  validatePreviousStation: true,
  validateDuplicateBarcode: true,
  customerQrRequired: false,
  customerQrRequiredConfigured: false,
  validateCustomerCode: false,
  allowCustomerQrOnlyStart: false,
  allowCustomerQrOnlyStartConfigured: false,
  customerCodePattern: "",
  finalPacking: false,
};

function normalizeStation(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizePlcPartCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 20);
}

function normalizeScope(scope = {}) {
  return {
    plantId: Number(scope.plantId ?? scope.plant_id ?? 0) || null,
    lineId: Number(scope.lineId ?? scope.line_id ?? 0) || null,
    machineId: Number(scope.machineId ?? scope.machine_id ?? 0) || null,
  };
}

// Per-machine overrides for stations that have more than one machine
// (e.g. OP150 Leak-Test-01/02/03). Stored inside the station row's config
// JSON as config.machineOverrides = { "<machineId>": { plcCommunication: false, ... } }
// so no schema change is needed. Only keys present in an override replace the
// station value; everything else is inherited from the station.
const MACHINE_OVERRIDE_BOOLEAN_KEYS = [
  "qr",
  "operation",
  "plcCommunication",
  "bypass",
  "rejectionBin",
  "manualResult",
  "validateQrFormat",
  "validateShotNumber",
  "validatePreviousStation",
  "validateDuplicateBarcode",
];
const MACHINE_OVERRIDE_KEYS = [...MACHINE_OVERRIDE_BOOLEAN_KEYS, "plcPartCount"];

function parseConfigJson(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeMachineOverride(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of MACHINE_OVERRIDE_BOOLEAN_KEYS) {
    if (raw[key] === true || raw[key] === false) out[key] = raw[key];
  }
  if (raw.plcPartCount !== undefined && raw.plcPartCount !== null && raw.plcPartCount !== "") {
    out.plcPartCount = normalizePlcPartCount(raw.plcPartCount);
  }
  return out;
}

function normalizeMachineOverrides(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.entries(raw).reduce((acc, [machineId, value]) => {
    const id = Number(machineId);
    if (!Number.isInteger(id) || id <= 0) return acc;
    const normalized = normalizeMachineOverride(value);
    if (Object.keys(normalized).length > 0) acc[String(id)] = normalized;
    return acc;
  }, {});
}

function applyMachineOverride(stationFeatures = {}, overrides = {}, machineId = null) {
  const id = Number(machineId || 0);
  const override = id ? normalizeMachineOverrides(overrides)[String(id)] : null;
  if (!override) {
    return { ...stationFeatures, machineId: id || null, machineOverride: false };
  }
  return { ...stationFeatures, ...override, machineId: id, machineOverride: true, machineOverrideKeys: Object.keys(override) };
}

function rowSpecificity(row, scope) {
  let score = 0;
  if (scope.plantId && Number(row.plant_id) === Number(scope.plantId)) score += 1;
  if (scope.lineId && Number(row.line_id) === Number(scope.lineId)) score += 2;
  return score;
}

async function findStationRow(normalizedStation, scope) {
  const rows = await StationFeatureSetting.findAll({
    where: {
      station_no: normalizedStation,
      plant_id: scope.plantId ? { [Op.or]: [scope.plantId, null] } : null,
      line_id: scope.lineId ? { [Op.or]: [scope.lineId, null] } : null,
    },
  });
  return rows.sort((a, b) => rowSpecificity(b, scope) - rowSpecificity(a, scope))[0] || null;
}

/** Normalized { "<machineId>": {...override} } map for one station. */
async function getStationMachineOverrides(stationNo, scopeInput = {}) {
  const normalizedStation = normalizeStation(stationNo);
  if (!normalizedStation) return {};
  const row = await findStationRow(normalizedStation, normalizeScope(scopeInput));
  if (!row) return {};
  return normalizeMachineOverrides(parseConfigJson(row.config).machineOverrides);
}

/** True when a machine override bypasses the machine (bypass ON or operation OFF). */
function isMachineOverrideBypassed(overrides = {}, machineId) {
  const override = overrides?.[String(Number(machineId || 0))];
  return Boolean(override && (override.bypass === true || override.operation === false));
}

/**
 * Effective feature config. Pass scope.machineId to resolve the per-machine
 * override of a shared station; without it the station-level config is
 * returned (unchanged behaviour).
 */
async function getStationFeatureConfig(stationNo, scopeInput = {}) {
  const normalizedStation = normalizeStation(stationNo);
  if (!normalizedStation) {
    return { ...DEFAULT_FEATURES };
  }

  const scope = normalizeScope(scopeInput);
  const row = await findStationRow(normalizedStation, scope);

  if (!row) {
    return scope.machineId ? applyMachineOverride(DEFAULT_FEATURES, {}, scope.machineId) : { ...DEFAULT_FEATURES };
  }

  const config = parseConfigJson(row.config);

  const stationFeatures = {
    qr: row.qr_enabled !== false,
    operation: row.operation_enabled !== false,
    plcCommunication: config.plcCommunication !== false,
    bypass: config.bypass === true || config.bypassEnabled === true,
    rejectionBin: row.rejection_bin_enabled !== false,
    rejectionCategoryCR: config.rejectionCategoryCR !== false,
    rejectionCategoryCRAM: config.rejectionCategoryCRAM !== false,
    rejectionCategoryMR: config.rejectionCategoryMR !== false,
    manualResult: row.manual_result_enabled === true,
    plcPartCount: normalizePlcPartCount(row.plc_part_count),
    validateQrFormat: config.validateQrFormat !== false,
    validateShotNumber: config.validateShotNumber === true,
    validatePreviousStation: config.validatePreviousStation !== false,
    validateDuplicateBarcode: config.validateDuplicateBarcode !== false,
    customerQrRequired: config.customerQrRequired === true ||
      config.requiresCustomerQr === true ||
      config.customerQrRequiredForCompletion === true,
    customerQrRequiredConfigured: Object.prototype.hasOwnProperty.call(config, "customerQrRequired") ||
      Object.prototype.hasOwnProperty.call(config, "requiresCustomerQr") ||
      Object.prototype.hasOwnProperty.call(config, "customerQrRequiredForCompletion"),
    validateCustomerCode: config.validateCustomerCode === true,
    allowCustomerQrOnlyStart: config.allowCustomerQrOnlyStart === true,
    allowCustomerQrOnlyStartConfigured: Object.prototype.hasOwnProperty.call(config, "allowCustomerQrOnlyStart"),
    customerCodePattern: String(config.customerCodePattern || ""),
    finalPacking: row.final_packing_enabled === true,
  };
  if (!scope.machineId) {
    return stationFeatures;
  }
  return applyMachineOverride(stationFeatures, config.machineOverrides, scope.machineId);
}



async function getFinalPackingStations() {
  const rows = await StationFeatureSetting.findAll({
    where: { final_packing_enabled: true },
    attributes: ["station_no"],
    order: [["station_no", "ASC"]],
  });

  return rows
    .map((row) => normalizeStation(row.station_no))
    .filter(Boolean);
}

module.exports = {
  DEFAULT_FEATURES,
  MACHINE_OVERRIDE_KEYS,
  normalizeMachineOverrides,
  applyMachineOverride,
  getStationMachineOverrides,
  isMachineOverrideBypassed,
  normalizePlcPartCount,
  getStationFeatureConfig,
  getFinalPackingStations,
};
