const STORAGE_KEY = "traceability-role-access-settings-v1";

export const ACCESS_LEVEL_OPTIONS = [
  { value: "HIDDEN", label: "Hidden" },
  { value: "VIEW", label: "View" },
  { value: "VIEW_EDIT", label: "View/Edit" },
  { value: "VIEW_CONTROL", label: "View/Control" },
];

export const ROLE_KEYS = ["admin", "engineer", "supervisor", "operator"];

export const MODULE_ACCESS_META = [
  { key: "dashboard", label: "Master Console" },
  { key: "production", label: "Production" },
  { key: "io_monitor", label: "I/O Monitor" },
  { key: "part_journey", label: "Part Journey" },
  { key: "process_flow", label: "Traceability Process Flow" },
  { key: "operator_view", label: "Operator View" },
  { key: "packing", label: "Packing" },
  { key: "packing_management", label: "Packing Management" },
  { key: "master_settings", label: "Master Settings" },
  { key: "machines", label: "Machines" },
  { key: "plc_config", label: "PLC Config" },
  { key: "scanners", label: "Scanners" },
  { key: "shifts", label: "Shifts" },
  { key: "qr_rules", label: "QR Rules" },
  { key: "users", label: "Users" },
];

const DEFAULT_FALLBACK = { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" };
const VALID_ACCESS = new Set(ACCESS_LEVEL_OPTIONS.map((entry) => entry.value));

export const DEFAULT_ROLE_ACCESS_SETTINGS = {
  dashboard: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  production: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  io_monitor: { admin: "VIEW_CONTROL", engineer: "VIEW_CONTROL", supervisor: "VIEW", operator: "VIEW" },
  part_journey: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  process_flow: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  operator_view: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  packing: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  packing_management: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN" },
  master_settings: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  machines: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN" },
  plc_config: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN" },
  scanners: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN" },
  shifts: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  qr_rules: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  users: { admin: "VIEW_EDIT", engineer: "HIDDEN", supervisor: "HIDDEN", operator: "HIDDEN" },
};

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeAccess(value, fallback = "HIDDEN") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return VALID_ACCESS.has(normalized) ? normalized : fallback;
}

function normalizeModuleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeRoleAccessSettings(rawSettings = {}) {
  const normalized = {};

  for (const [moduleKey, defaults] of Object.entries(DEFAULT_ROLE_ACCESS_SETTINGS)) {
    const source = rawSettings?.[moduleKey] || {};
    normalized[moduleKey] = {
      admin: normalizeAccess(source.admin, defaults.admin),
      engineer: normalizeAccess(source.engineer, defaults.engineer),
      supervisor: normalizeAccess(source.supervisor, defaults.supervisor),
      operator: normalizeAccess(source.operator, defaults.operator),
    };
  }

  for (const [rawModuleKey, rawValue] of Object.entries(rawSettings || {})) {
    const moduleKey = normalizeModuleKey(rawModuleKey);
    if (!moduleKey || normalized[moduleKey] || !rawValue || typeof rawValue !== "object") {
      continue;
    }
    normalized[moduleKey] = {
      admin: normalizeAccess(rawValue.admin, DEFAULT_FALLBACK.admin),
      engineer: normalizeAccess(rawValue.engineer, DEFAULT_FALLBACK.engineer),
      supervisor: normalizeAccess(rawValue.supervisor, DEFAULT_FALLBACK.supervisor),
      operator: normalizeAccess(rawValue.operator, DEFAULT_FALLBACK.operator),
    };
  }

  return normalized;
}

export function getRoleAccessSettings() {
  if (typeof window === "undefined") {
    return normalizeRoleAccessSettings(DEFAULT_ROLE_ACCESS_SETTINGS);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return normalizeRoleAccessSettings(DEFAULT_ROLE_ACCESS_SETTINGS);
    }
    return normalizeRoleAccessSettings(JSON.parse(raw));
  } catch {
    return normalizeRoleAccessSettings(DEFAULT_ROLE_ACCESS_SETTINGS);
  }
}

export function saveRoleAccessSettings(settings) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeRoleAccessSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function getRoleAccessLevel(role, moduleKey, settings = getRoleAccessSettings()) {
  const normalizedRole = normalizeRole(role);
  const normalizedModule = normalizeModuleKey(moduleKey);
  const moduleSettings = settings?.[normalizedModule] || DEFAULT_ROLE_ACCESS_SETTINGS[normalizedModule] || DEFAULT_FALLBACK;
  return normalizeAccess(moduleSettings?.[normalizedRole], DEFAULT_FALLBACK[normalizedRole] || "HIDDEN");
}

export function canAccessModule(role, moduleKey, settings = getRoleAccessSettings()) {
  return getRoleAccessLevel(role, moduleKey, settings) !== "HIDDEN";
}

export function formatAccessLevel(value) {
  const normalized = normalizeAccess(value, "HIDDEN");
  return ACCESS_LEVEL_OPTIONS.find((entry) => entry.value === normalized)?.label || "Hidden";
}
