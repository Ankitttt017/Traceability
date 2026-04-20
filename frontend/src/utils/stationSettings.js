const STORAGE_KEY = "traceability-station-feature-settings-v1";
const LEGACY_STORAGE_KEYS = ["traceability-station-feature-settings"];

export const DEFAULT_STATION_FEATURES = {
  qr: true,
  operation: true,
  bypass: false,
  rejectionBin: true,
  plcConfirmation: true,
  manualResult: false,
  plcPartCount: 1,
  finalPacking: false,
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePlcPartCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 20);
}

export function normalizeStationKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeFeatureMap(rawMap) {
  if (!isObject(rawMap)) {
    return {};
  }

  return Object.entries(rawMap).reduce((acc, [rawKey, rawValue]) => {
    const stationKey = normalizeStationKey(rawKey);
    if (!stationKey || !isObject(rawValue)) {
      return acc;
    }

    acc[stationKey] = {
      qr: rawValue.qr !== false,
      operation: rawValue.operation !== false,
      bypass: rawValue.bypass === true || rawValue.bypassEnabled === true,
      rejectionBin: rawValue.rejectionBin !== false,
      plcConfirmation: rawValue.plcConfirmation !== false,
      manualResult: rawValue.manualResult === true,
      plcPartCount: normalizePlcPartCount(rawValue.plcPartCount ?? rawValue.plc_part_count),
      finalPacking: rawValue.finalPacking === true,
    };
    return acc;
  }, {});
}

function readLegacySettings() {
  if (typeof window === "undefined") {
    return {};
  }

  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(legacyKey);
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw);
      const normalized = normalizeFeatureMap(parsed);
      if (Object.keys(normalized).length > 0) {
        return normalized;
      }
    } catch {
      // Ignore malformed legacy payloads.
    }
  }

  return {};
}

export function getStationFeatureSettings() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeFeatureMap(JSON.parse(raw));
    }
  } catch {
    // Ignore malformed storage payloads and fallback to defaults.
  }

  const legacy = readLegacySettings();
  if (Object.keys(legacy).length > 0) {
    saveStationFeatureSettings(legacy);
    return legacy;
  }

  return {};
}

export function saveStationFeatureSettings(settings) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeFeatureMap(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function getStationFeatures(stationNo, settings = {}) {
  const stationKey = normalizeStationKey(stationNo);
  if (!stationKey) {
    return { ...DEFAULT_STATION_FEATURES };
  }

  const stationSettings = settings[stationKey];
  if (!stationSettings) {
    return { ...DEFAULT_STATION_FEATURES };
  }

  return {
    qr: stationSettings.qr !== false,
    operation: stationSettings.operation !== false,
    bypass: stationSettings.bypass === true || stationSettings.bypassEnabled === true,
    rejectionBin: stationSettings.rejectionBin !== false,
    plcConfirmation: stationSettings.plcConfirmation !== false,
    manualResult: stationSettings.manualResult === true,
    plcPartCount: normalizePlcPartCount(stationSettings.plcPartCount ?? stationSettings.plc_part_count),
    finalPacking: stationSettings.finalPacking === true,
  };
}

export function mergeStationFeatureSettings(stations = [], settings = {}) {
  const merged = normalizeFeatureMap(settings);

  for (const station of stations) {
    const key = normalizeStationKey(station);
    if (!key || merged[key]) {
      continue;
    }
    merged[key] = { ...DEFAULT_STATION_FEATURES };
  }

  return merged;
}

export function getStationFeatureCoverage(settings = {}, stations = []) {
  const merged = mergeStationFeatureSettings(stations, settings);
  const values = Object.values(merged);
  const total = values.length;
  if (total === 0) {
    return {
      total: 0,
      qrEnabled: 0,
      operationEnabled: 0,
      bypassEnabled: 0,
      rejectionBinEnabled: 0,
      plcConfirmationEnabled: 0,
      manualResultEnabled: 0,
      finalPackingEnabled: 0,
    };
  }

  return values.reduce(
    (acc, entry) => ({
      total,
      qrEnabled: acc.qrEnabled + (entry.qr ? 1 : 0),
      operationEnabled: acc.operationEnabled + (entry.operation ? 1 : 0),
      bypassEnabled: acc.bypassEnabled + (entry.bypass ? 1 : 0),
      rejectionBinEnabled: acc.rejectionBinEnabled + (entry.rejectionBin ? 1 : 0),
      plcConfirmationEnabled: acc.plcConfirmationEnabled + (entry.plcConfirmation ? 1 : 0),
      manualResultEnabled: acc.manualResultEnabled + (entry.manualResult ? 1 : 0),
      finalPackingEnabled: acc.finalPackingEnabled + (entry.finalPacking ? 1 : 0),
    }),
    {
      total,
      qrEnabled: 0,
      operationEnabled: 0,
      bypassEnabled: 0,
      rejectionBinEnabled: 0,
      plcConfirmationEnabled: 0,
      manualResultEnabled: 0,
      finalPackingEnabled: 0,
    }
  );
}
