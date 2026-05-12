const StationFeatureSetting = require("../models/StationFeatureSetting");

const DEFAULT_FEATURES = {
  qr: true,
  operation: true,
  rejectionBin: true,
  manualResult: false,
  plcPartCount: 1,
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

async function getStationFeatureConfig(stationNo) {
  const normalizedStation = normalizeStation(stationNo);
  if (!normalizedStation) {
    return { ...DEFAULT_FEATURES };
  }

  const row = await StationFeatureSetting.findOne({
    where: { station_no: normalizedStation },
  });

  if (!row) {
    return { ...DEFAULT_FEATURES };
  }

  return {
    qr: row.qr_enabled !== false,
    operation: row.operation_enabled !== false,
    rejectionBin: row.rejection_bin_enabled !== false,
    manualResult: row.manual_result_enabled === true,
    plcPartCount: normalizePlcPartCount(row.plc_part_count),
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
