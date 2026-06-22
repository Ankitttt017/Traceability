const StationFeatureSetting = require("../models/StationFeatureSetting");

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

function normalizeInputMap(rawSettings = {}) {
  if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    return {};
  }

  return Object.entries(rawSettings).reduce((acc, [rawKey, rawValue]) => {
    const stationNo = normalizeStation(rawKey);
    if (!stationNo || !rawValue || typeof rawValue !== "object") {
      return acc;
    }

    // Preserve everything in the config object
    acc[stationNo] = {
      ...rawValue,
      qr: rawValue.qr !== false,
      operation: rawValue.operation !== false,
      plcCommunication: rawValue.plcCommunication !== false,
      rejectionBin: rawValue.rejectionBin !== false,
      rejectionCategoryCR: rawValue.rejectionCategoryCR !== false,
      rejectionCategoryCRAM: rawValue.rejectionCategoryCRAM !== false,
      rejectionCategoryMR: rawValue.rejectionCategoryMR !== false,
      qualityCheck: rawValue.qualityCheck === true,
      manualResult: rawValue.manualResult === true,
      plcPartCount: normalizePlcPartCount(rawValue.plcPartCount ?? rawValue.plc_part_count),
      validateQrFormat: rawValue.validateQrFormat !== false,
      validateShotNumber: rawValue.validateShotNumber !== false,
      validatePreviousStation: rawValue.validatePreviousStation !== false,
      validateDuplicateBarcode: rawValue.validateDuplicateBarcode !== false,
      validateCustomerCode: rawValue.validateCustomerCode === true,
      allowCustomerQrOnlyStart: rawValue.allowCustomerQrOnlyStart === true,
      customerCodePattern: String(rawValue.customerCodePattern || ""),
      finalPacking: rawValue.finalPacking === true,
    };
    return acc;
  }, {});
}

function rowsToMap(rows = []) {
  return rows.reduce((acc, row) => {
    const stationNo = normalizeStation(row.station_no);
    if (!stationNo) {
      return acc;
    }

    // Start with values from the config JSON column if available
    let config = {};
    if (row.config) {
      if (typeof row.config === "string") {
        try {
          config = JSON.parse(row.config);
        } catch (err) {
          config = {};
        }
      } else if (typeof row.config === "object") {
        config = row.config;
      }
    }

    acc[stationNo] = {
      ...config,
      qr: Boolean(row.qr_enabled),
      operation: Boolean(row.operation_enabled),
      plcCommunication: config.plcCommunication !== false,
      rejectionBin: Boolean(row.rejection_bin_enabled),
      rejectionCategoryCR: config.rejectionCategoryCR !== false,
      rejectionCategoryCRAM: config.rejectionCategoryCRAM !== false,
      rejectionCategoryMR: config.rejectionCategoryMR !== false,
      qualityCheck: config.qualityCheck === true,
      manualResult: row.manual_result_enabled === true,
      plcPartCount: normalizePlcPartCount(row.plc_part_count),
      validateQrFormat: config.validateQrFormat !== false,
      validateShotNumber: config.validateShotNumber !== false,
      validatePreviousStation: config.validatePreviousStation !== false,
      validateDuplicateBarcode: config.validateDuplicateBarcode !== false,
      validateCustomerCode: config.validateCustomerCode === true,
      allowCustomerQrOnlyStart: config.allowCustomerQrOnlyStart === true,
      customerCodePattern: String(config.customerCodePattern || ""),
      finalPacking: row.final_packing_enabled === true,
    };
    return acc;
  }, {});
}

exports.getSettings = async (_req, res) => {
  try {
    const rows = await StationFeatureSetting.findAll({
      order: [["station_no", "ASC"]],
    });
    res.json(rowsToMap(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const payload = normalizeInputMap(req.body?.settings || req.body);
    const stations = Object.keys(payload);

    if (stations.length === 0) {
      return res.status(400).json({ error: "At least one station setting is required" });
    }

    await Promise.all(
      stations.map((stationNo) => {
        const data = payload[stationNo];
        
        // Sanitize data to ensure only valid fields are passed to Sequelize
        const updateData = {
          station_no: stationNo,
          qr_enabled: Boolean(data.qr),
          operation_enabled: Boolean(data.operation),
          rejection_bin_enabled: Boolean(data.rejectionBin),
          manual_result_enabled: data.manualResult === true,
          plc_part_count: normalizePlcPartCount(data.plcPartCount ?? data.plc_part_count),
          final_packing_enabled: data.finalPacking === true,
          config: JSON.stringify(data), // JSON column handles the full object as string
          updated_by: req.user?.id || null,
        };

        return StationFeatureSetting.upsert(updateData);
      })
    );

    const rows = await StationFeatureSetting.findAll({
      where: { station_no: stations },
      order: [["station_no", "ASC"]],
    });

    res.json({
      message: "Station settings saved",
      settings: rowsToMap(rows),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
