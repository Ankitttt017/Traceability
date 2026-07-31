const RoleAccessSetting = require("../models/RoleAccessSetting");

const ACCESS_LEVELS = new Set(["HIDDEN", "VIEW", "VIEW_EDIT", "VIEW_CONTROL"]);
const ROLE_KEYS = [
  "super_admin",
  "company_admin",
  "plant_admin",
  "production_manager",
  "quality_manager",
  "maintenance",
  "engineer",
  "supervisor",
  "operator",
  "auditor",
  "viewer",
];

const DEFAULT_FALLBACK = {
  super_admin: "VIEW_CONTROL",
  company_admin: "VIEW_EDIT",
  plant_admin: "VIEW_EDIT",
  production_manager: "VIEW",
  quality_manager: "VIEW",
  maintenance: "VIEW",
  engineer: "VIEW",
  supervisor: "VIEW",
  operator: "HIDDEN",
  auditor: "VIEW",
  viewer: "VIEW",
};

const DEFAULT_ROLE_ACCESS_SETTINGS = {
  dashboard: { ...DEFAULT_FALLBACK, operator: "VIEW" },
  traceability: { ...DEFAULT_FALLBACK, operator: "VIEW" },
  production: { ...DEFAULT_FALLBACK, production_manager: "VIEW_EDIT" },
  reports: { ...DEFAULT_FALLBACK, auditor: "VIEW", viewer: "VIEW" },
  rejection_analysis: { ...DEFAULT_FALLBACK, quality_manager: "VIEW_EDIT", auditor: "VIEW", viewer: "VIEW" },
  io_monitor: { ...DEFAULT_FALLBACK, engineer: "VIEW_CONTROL", maintenance: "VIEW_CONTROL", operator: "VIEW" },
  part_journey: { ...DEFAULT_FALLBACK },
  part_process_flow: { ...DEFAULT_FALLBACK, operator: "VIEW" },
  process_flow: { ...DEFAULT_FALLBACK, operator: "VIEW" },
  operator_view: { ...DEFAULT_FALLBACK, operator: "VIEW" },
  control_plan: { ...DEFAULT_FALLBACK, operator: "VIEW", quality_manager: "VIEW_EDIT" },
  packing: { ...DEFAULT_FALLBACK, operator: "VIEW" },
  packing_management: { ...DEFAULT_FALLBACK, production_manager: "VIEW_EDIT" },
  master_settings: { ...DEFAULT_FALLBACK, engineer: "HIDDEN", supervisor: "HIDDEN", operator: "HIDDEN", maintenance: "HIDDEN", auditor: "HIDDEN", viewer: "HIDDEN" },
  plants: { ...DEFAULT_FALLBACK, engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", auditor: "HIDDEN", viewer: "HIDDEN" },
  lines: { ...DEFAULT_FALLBACK, engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", auditor: "HIDDEN", viewer: "HIDDEN" },
  parts: { ...DEFAULT_FALLBACK, engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", auditor: "HIDDEN", viewer: "HIDDEN" },
  rejection_config: { ...DEFAULT_FALLBACK, quality_manager: "VIEW_EDIT", engineer: "VIEW", operator: "HIDDEN", auditor: "HIDDEN", viewer: "HIDDEN" },
  station_control: { ...DEFAULT_FALLBACK, engineer: "VIEW_EDIT", maintenance: "VIEW_EDIT", operator: "HIDDEN" },
  report_config: { ...DEFAULT_FALLBACK, quality_manager: "VIEW_EDIT", operator: "HIDDEN" },
  machines: { ...DEFAULT_FALLBACK, engineer: "VIEW_EDIT", maintenance: "VIEW_EDIT", operator: "HIDDEN" },
  plc_config: { ...DEFAULT_FALLBACK, engineer: "VIEW_EDIT", maintenance: "VIEW_EDIT", operator: "HIDDEN" },
  scanners: { ...DEFAULT_FALLBACK, engineer: "VIEW_EDIT", operator: "HIDDEN" },
  scanner_monitor: { ...DEFAULT_FALLBACK, operator: "HIDDEN" },
  shifts: { ...DEFAULT_FALLBACK, production_manager: "VIEW_EDIT", operator: "HIDDEN" },
  qr_rules: { ...DEFAULT_FALLBACK, engineer: "VIEW_EDIT", operator: "HIDDEN" },
  users: { ...DEFAULT_FALLBACK, engineer: "HIDDEN", supervisor: "HIDDEN", operator: "HIDDEN", maintenance: "HIDDEN", auditor: "HIDDEN", viewer: "HIDDEN" },
  faq: { ...DEFAULT_FALLBACK, operator: "VIEW" },
};

const CACHE_TTL_MS = Math.max(Number(process.env.ROLE_ACCESS_CACHE_TTL_MS || 5000), 0);

let cachedSettings = null;
let cacheUpdatedAt = 0;

function normalizeModuleKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUserRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized === "admin") return "super_admin";
  if (normalized === "other") return "viewer";
  return normalized;
}

function roleColumn(roleKey) {
  return `${roleKey}_access`;
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
    ROLE_KEYS.map((roleKey) => {
      const legacyValue = roleKey === "super_admin" ? source.admin : roleKey === "viewer" ? source.other : undefined;
      return [
        roleKey,
        normalizeAccessLevel(source?.[roleKey] ?? legacyValue, fallback?.[roleKey] || DEFAULT_FALLBACK[roleKey]),
      ];
    })
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
    const rowAccess = Object.fromEntries(
      ROLE_KEYS.map((roleKey) => [roleKey, row[roleColumn(roleKey)]])
    );
    rowAccess.admin = row.admin_access;
    rowAccess.other = row.other_access;
    merged[moduleKey] = buildRoleMap(rowAccess, merged[moduleKey] || DEFAULT_FALLBACK);
  }
  return merged;
}

function roleMapToRow(moduleKey, roleMap = {}) {
  return {
    module_key: moduleKey,
    ...Object.fromEntries(ROLE_KEYS.map((roleKey) => [roleColumn(roleKey), roleMap[roleKey]])),
    admin_access: roleMap.super_admin,
    other_access: roleMap.viewer,
  };
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
    missing.map((moduleKey) => RoleAccessSetting.create(roleMapToRow(moduleKey, DEFAULT_ROLE_ACCESS_SETTINGS[moduleKey])))
  );
}

function setRoleAccessSettingsCache(settings) {
  cachedSettings = rowsToMap(
    Object.entries(settings || {}).map(([moduleKey, roleMap]) => roleMapToRow(moduleKey, roleMap))
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
  ROLE_KEYS,
  DEFAULT_ROLE_ACCESS_SETTINGS,
  normalizeModuleKey,
  normalizeSettingsInput,
  ensureDefaultModules,
  getRoleAccessSettings,
  getRoleAccessLevel,
  canRoleAccess,
  setRoleAccessSettingsCache,
  invalidateRoleAccessCache,
  roleMapToRow,
};
