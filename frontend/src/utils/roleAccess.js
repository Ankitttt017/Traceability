const STORAGE_KEY = "traceability-role-access-settings-v1";

export const ACCESS_LEVEL_OPTIONS = [
  { value: "HIDDEN", label: "Hidden" },
  { value: "VIEW", label: "View" },
  { value: "VIEW_EDIT", label: "View/Edit" },
  { value: "VIEW_CONTROL", label: "View/Control" },
];

export const USER_ROLE_OPTIONS = [
  { value: "Super Admin", key: "super_admin", label: "Super Admin" },
  { value: "Company Admin", key: "company_admin", label: "Company Admin" },
  { value: "Plant Admin", key: "plant_admin", label: "Plant Admin" },
  { value: "Production Manager", key: "production_manager", label: "Production Manager" },
  { value: "Quality Manager", key: "quality_manager", label: "Quality Manager" },
  { value: "Maintenance", key: "maintenance", label: "Maintenance" },
  { value: "Engineer", key: "engineer", label: "Engineer" },
  { value: "Supervisor", key: "supervisor", label: "Supervisor" },
  { value: "Operator", key: "operator", label: "Operator" },
  { value: "Auditor", key: "auditor", label: "Auditor" },
  { value: "Viewer", key: "viewer", label: "Viewer" },
];

export const ROLE_KEYS = USER_ROLE_OPTIONS.map((role) => role.key);

export const MODULE_ACCESS_META = [
  { key: "dashboard", label: "Dashboard" },
  { key: "production", label: "Production" },
  { key: "reports", label: "Reports" },
  { key: "rejection_analysis", label: "Rejection Analysis" },
  { key: "io_monitor", label: "I/O Monitor" },
  { key: "part_journey", label: "Part Journey" },
  { key: "part_process_flow", label: "Part Process Flow" },
  { key: "process_flow", label: "Traceability Process Flow" },
  { key: "operator_view", label: "Operator View" },
  { key: "control_plan", label: "Control Plan" },
  { key: "packing", label: "Packing" },
  { key: "packing_management", label: "Packing Management" },
  { key: "master_settings", label: "Role Access" },
  { key: "plants", label: "Plant Manager" },
  { key: "lines", label: "Line Manager" },
  { key: "parts", label: "Part Manager" },
  { key: "rejection_config", label: "Rejection Configuration" },
  { key: "station_control", label: "Station Control" },
  { key: "report_config", label: "Report Configuration" },
  { key: "machines", label: "Machines" },
  { key: "plc_config", label: "PLC Config" },
  { key: "scanners", label: "Scanners" },
  { key: "scanner_monitor", label: "Scanner Monitor" },
  { key: "shifts", label: "Shifts" },
  { key: "qr_rules", label: "QR Rules" },
  { key: "users", label: "Users" },
  { key: "faq", label: "FAQ" },
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
const VALID_ACCESS = new Set(ACCESS_LEVEL_OPTIONS.map((entry) => entry.value));
const EDIT_ACCESS = new Set(["VIEW_EDIT", "VIEW_CONTROL"]);
const CONTROL_ACCESS = new Set(["VIEW_CONTROL"]);

export const DEFAULT_ROLE_ACCESS_SETTINGS = {
  dashboard: { ...DEFAULT_FALLBACK, operator: "VIEW" },
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

function normalizeRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized === "admin") return "super_admin";
  if (normalized === "other") return "viewer";
  return normalized;
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

function getStoredUser() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export function normalizePageAccessOverrides(rawOverrides = {}) {
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
    return {};
  }
  return Object.entries(rawOverrides).reduce((acc, [moduleKey, accessLevel]) => {
    const normalizedModule = normalizeModuleKey(moduleKey);
    const normalizedAccess = normalizeAccess(accessLevel, "");
    if (normalizedModule && VALID_ACCESS.has(normalizedAccess)) {
      acc[normalizedModule] = normalizedAccess;
    }
    return acc;
  }, {});
}

export function normalizeRoleAccessSettings(rawSettings = {}) {
  const normalized = {};

  for (const [moduleKey, defaults] of Object.entries(DEFAULT_ROLE_ACCESS_SETTINGS)) {
    const source = rawSettings?.[moduleKey] || {};
    normalized[moduleKey] = Object.fromEntries(
      ROLE_KEYS.map((roleKey) => {
        const legacyValue = roleKey === "super_admin" ? source.admin : roleKey === "viewer" ? source.other : undefined;
        return [
          roleKey,
          normalizeAccess(source[roleKey] ?? legacyValue, defaults[roleKey] || DEFAULT_FALLBACK[roleKey]),
        ];
      })
    );
  }

  for (const [rawModuleKey, rawValue] of Object.entries(rawSettings || {})) {
    const moduleKey = normalizeModuleKey(rawModuleKey);
    if (!moduleKey || normalized[moduleKey] || !rawValue || typeof rawValue !== "object") {
      continue;
    }
    normalized[moduleKey] = Object.fromEntries(
      ROLE_KEYS.map((roleKey) => {
        const legacyValue = roleKey === "super_admin" ? rawValue.admin : roleKey === "viewer" ? rawValue.other : undefined;
        return [
          roleKey,
          normalizeAccess(rawValue[roleKey] ?? legacyValue, DEFAULT_FALLBACK[roleKey]),
        ];
      })
    );
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

export function getEffectiveAccessLevel(roleOrUser, moduleKey, settings = getRoleAccessSettings()) {
  const normalizedModule = normalizeModuleKey(moduleKey);
  const user = typeof roleOrUser === "object" && roleOrUser !== null ? roleOrUser : getStoredUser();
  const overrides = normalizePageAccessOverrides(user?.pageAccessOverrides);
  if (Object.prototype.hasOwnProperty.call(overrides, normalizedModule)) {
    return normalizeAccess(overrides[normalizedModule], "HIDDEN");
  }
  const role = typeof roleOrUser === "object" && roleOrUser !== null ? roleOrUser.role : roleOrUser;
  return getRoleAccessLevel(role, normalizedModule, settings);
}

export function canAccessModule(roleOrUser, moduleKey, settings = getRoleAccessSettings()) {
  return getEffectiveAccessLevel(roleOrUser, moduleKey, settings) !== "HIDDEN";
}

export function canEditModule(roleOrUser, moduleKey, settings = getRoleAccessSettings()) {
  return EDIT_ACCESS.has(getEffectiveAccessLevel(roleOrUser, moduleKey, settings));
}

export function canControlModule(roleOrUser, moduleKey, settings = getRoleAccessSettings()) {
  return CONTROL_ACCESS.has(getEffectiveAccessLevel(roleOrUser, moduleKey, settings));
}

export function formatAccessLevel(value) {
  const normalized = normalizeAccess(value, "HIDDEN");
  return ACCESS_LEVEL_OPTIONS.find((entry) => entry.value === normalized)?.label || "Hidden";
}
