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
  };
}

function rowSpecificity(row, scope) {
  let score = 0;
  if (scope.plantId && Number(row.plant_id) === Number(scope.plantId)) score += 1;
  if (scope.lineId && Number(row.line_id) === Number(scope.lineId)) score += 2;
  return score;
}

async function getStationFeatureConfig(stationNo, scopeInput = {}) {
  const normalizedStation = normalizeStation(stationNo);
  if (!normalizedStation) {
    return { ...DEFAULT_FEATURES };
  }

  const scope = normalizeScope(scopeInput);
  const rows = await StationFeatureSetting.findAll({
    where: {
      station_no: normalizedStation,
      plant_id: scope.plantId ? { [Op.or]: [scope.plantId, null] } : null,
      line_id: scope.lineId ? { [Op.or]: [scope.lineId, null] } : null,
    },
  });
  const row = rows.sort((a, b) => rowSpecificity(b, scope) - rowSpecificity(a, scope))[0];

  if (!row) {
    return { ...DEFAULT_FEATURES };
  }

  let config = {};
  if (row.config) {
    if (typeof row.config === "string") {
      try {
        config = JSON.parse(row.config);
      } catch (_error) {
        config = {};
      }
    } else if (typeof row.config === "object") {
      config = row.config;
    }
  }

  return {
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
  normalizePlcPartCount,
  getStationFeatureConfig,
  getFinalPackingStations,
};
