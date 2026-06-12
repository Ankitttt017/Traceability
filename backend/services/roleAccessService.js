const RoleAccessSetting = require("../models/RoleAccessSetting");

const ACCESS_LEVELS = new Set(["HIDDEN", "VIEW", "VIEW_EDIT", "VIEW_CONTROL"]);
const ROLE_KEYS = ["admin", "engineer", "supervisor", "operator", "other"];
const DEFAULT_FALLBACK = {
  admin: "VIEW_EDIT",
  engineer: "VIEW",
  supervisor: "VIEW",
  operator: "HIDDEN",
  other: "HIDDEN",
};

const DEFAULT_ROLE_ACCESS_SETTINGS = {
  dashboard: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  production: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  reports: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  traceability: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  io_monitor: { admin: "VIEW_CONTROL", engineer: "VIEW_CONTROL", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  part_journey: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  part_process_flow: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  process_flow: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  operator_view: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  control_plan: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  packing: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  packing_management: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  master_settings: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  station_control: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  report_config: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  machines: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  plc_config: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  scanners: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  scanner_monitor: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  shifts: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  qr_rules: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  users: { admin: "VIEW_EDIT", engineer: "HIDDEN", supervisor: "HIDDEN", operator: "HIDDEN", other: "HIDDEN" },
  faq: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
};

const CACHE_TTL_MS = Math.max(Number(process.env.ROLE_ACCESS_CACHE_TTL_MS || 5000), 0);

let cachedSettings = null;
let cacheUpdatedAt = 0;

function normalizeModuleKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUserRole(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAccessLevel(value, fallback = "HIDDEN") {
  const normalized = String(value || "").trim().toUpperCase();
  return ACCESS_LEVELS.has(normalized) ? normalized : fallback;
}

function cloneDefaultSettings() {
  return Object.fromEntries(
    Object.entries(DEFAULT_ROLE_ACCESS_SETTINGS).map(([moduleKey, values]) => [moduleKey, { ...values }])
  );
}

function buildRoleMap(source = {}, fallback = DEFAULT_FALLBACK) {
  return Object.fromEntries(
    ROLE_KEYS.map((roleKey) => [
      roleKey,
      normalizeAccessLevel(source?.[roleKey], fallback?.[roleKey] || DEFAULT_FALLBACK[roleKey]),
    ])
  );
}

function normalizeSettingsInput(rawSettings = {}) {
  if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    return {};
  }

  return Object.entries(rawSettings).reduce((acc, [rawModuleKey, rawValue]) => {
    const moduleKey = normalizeModuleKey(rawModuleKey);
    if (!moduleKey || !rawValue || typeof rawValue !== "object") {
      return acc;
    }
    acc[moduleKey] = buildRoleMap(rawValue, DEFAULT_ROLE_ACCESS_SETTINGS[moduleKey] || DEFAULT_FALLBACK);
    return acc;
  }, {});
}

function rowsToMap(rows = []) {
  const merged = cloneDefaultSettings();
  for (const row of rows) {
    const moduleKey = normalizeModuleKey(row.module_key);
    if (!moduleKey) {
      continue;
    }
    merged[moduleKey] = buildRoleMap(
      {
        admin: row.admin_access,
        engineer: row.engineer_access,
        supervisor: row.supervisor_access,
        operator: row.operator_access,
        other: row.other_access,
      },
      merged[moduleKey] || DEFAULT_FALLBACK
    );
  }
  return merged;
}

async function ensureDefaultModules() {
  const moduleKeys = Object.keys(DEFAULT_ROLE_ACCESS_SETTINGS);
  const existingRows = await RoleAccessSetting.findAll({
    where: { module_key: moduleKeys },
    attributes: ["module_key"],
  });
  const existing = new Set(existingRows.map((row) => normalizeModuleKey(row.module_key)));
  const missing = moduleKeys.filter((moduleKey) => !existing.has(moduleKey));
  if (missing.length === 0) {
    return;
  }

  await Promise.all(
    missing.map((moduleKey) => {
      const defaults = DEFAULT_ROLE_ACCESS_SETTINGS[moduleKey];
      return RoleAccessSetting.create({
        module_key: moduleKey,
        admin_access: defaults.admin,
        engineer_access: defaults.engineer,
        supervisor_access: defaults.supervisor,
        operator_access: defaults.operator,
        other_access: defaults.other,
      });
    })
  );
}

function setRoleAccessSettingsCache(settings) {
  cachedSettings = rowsToMap(
    Object.entries(settings || {}).map(([moduleKey, roleMap]) => ({
      module_key: moduleKey,
      admin_access: roleMap?.admin,
      engineer_access: roleMap?.engineer,
      supervisor_access: roleMap?.supervisor,
      operator_access: roleMap?.operator,
      other_access: roleMap?.other,
    }))
  );
  cacheUpdatedAt = Date.now();
}

function invalidateRoleAccessCache() {
  cachedSettings = null;
  cacheUpdatedAt = 0;
}

async function getRoleAccessSettings(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();
  if (!forceRefresh && cachedSettings && now - cacheUpdatedAt <= CACHE_TTL_MS) {
    return cachedSettings;
  }

  await ensureDefaultModules();
  const rows = await RoleAccessSetting.findAll({
    order: [["module_key", "ASC"]],
  });
  cachedSettings = rowsToMap(rows);
  cacheUpdatedAt = now;
  return cachedSettings;
}

function getRoleAccessLevel(role, moduleKey, settings = DEFAULT_ROLE_ACCESS_SETTINGS) {
  const normalizedRole = normalizeUserRole(role);
  const normalizedModule = normalizeModuleKey(moduleKey);
  const moduleSettings = settings?.[normalizedModule] || DEFAULT_ROLE_ACCESS_SETTINGS[normalizedModule] || DEFAULT_FALLBACK;
  return normalizeAccessLevel(moduleSettings?.[normalizedRole], DEFAULT_FALLBACK[normalizedRole] || "HIDDEN");
}

function canRoleAccess(role, moduleKey, mode = "view", settings = DEFAULT_ROLE_ACCESS_SETTINGS) {
  const level = getRoleAccessLevel(role, moduleKey, settings);
  switch (String(mode || "view").trim().toLowerCase()) {
    case "edit":
      return level === "VIEW_EDIT" || level === "VIEW_CONTROL";
    case "control":
      return level === "VIEW_CONTROL";
    case "operate":
      return level !== "HIDDEN";
    case "view":
    default:
      return level !== "HIDDEN";
  }
}

module.exports = {
  DEFAULT_ROLE_ACCESS_SETTINGS,
  normalizeModuleKey,
  normalizeSettingsInput,
  ensureDefaultModules,
  getRoleAccessSettings,
  getRoleAccessLevel,
  canRoleAccess,
  setRoleAccessSettingsCache,
  invalidateRoleAccessCache,
};
