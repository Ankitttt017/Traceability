const STORAGE_KEY = "traceability-role-access-settings-v1";

export const ACCESS_LEVEL_OPTIONS = [
  { value: "HIDDEN", label: "Hidden" },
  { value: "VIEW", label: "View" },
  { value: "VIEW_EDIT", label: "View/Edit" },
  { value: "VIEW_CONTROL", label: "View/Control" },
];

export const ROLE_KEYS = ["admin", "engineer", "supervisor", "operator", "other"];

export const MODULE_ACCESS_META = [
  { key: "dashboard", label: "Dashboard" },
  { key: "production", label: "Production" },
  { key: "reports", label: "Reports" },
  { key: "traceability", label: "Traceability" },
  { key: "io_monitor", label: "I/O Monitor" },
  { key: "part_journey", label: "Part Journey" },
  { key: "part_process_flow", label: "Part Process Flow" },
  { key: "process_flow", label: "Traceability Process Flow" },
  { key: "operator_view", label: "Operator View" },
  { key: "control_plan", label: "Control Plan" },
  { key: "packing", label: "Packing" },
  { key: "packing_management", label: "Packing Management" },
  { key: "master_settings", label: "Master Settings" },
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

const DEFAULT_FALLBACK = { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" };
const VALID_ACCESS = new Set(ACCESS_LEVEL_OPTIONS.map((entry) => entry.value));
const EDIT_ACCESS = new Set(["VIEW_EDIT", "VIEW_CONTROL"]);
const CONTROL_ACCESS = new Set(["VIEW_CONTROL"]);

export const DEFAULT_ROLE_ACCESS_SETTINGS = {
  dashboard: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  production: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  reports: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN", other: "HIDDEN" },
  traceability: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  io_monitor: { admin: "VIEW_CONTROL", engineer: "VIEW_CONTROL", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
  part_journey: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW", other: "HIDDEN" },
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
    normalized[moduleKey] = Object.fromEntries(
      ROLE_KEYS.map((roleKey) => [
        roleKey,
        normalizeAccess(source[roleKey], defaults[roleKey] || DEFAULT_FALLBACK[roleKey]),
      ])
    );
  }

  for (const [rawModuleKey, rawValue] of Object.entries(rawSettings || {})) {
    const moduleKey = normalizeModuleKey(rawModuleKey);
    if (!moduleKey || normalized[moduleKey] || !rawValue || typeof rawValue !== "object") {
      continue;
    }
    normalized[moduleKey] = Object.fromEntries(
      ROLE_KEYS.map((roleKey) => [
        roleKey,
        normalizeAccess(rawValue[roleKey], DEFAULT_FALLBACK[roleKey]),
      ])
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

export function canAccessModule(role, moduleKey, settings = getRoleAccessSettings()) {
  return getRoleAccessLevel(role, moduleKey, settings) !== "HIDDEN";
}

export function canEditModule(role, moduleKey, settings = getRoleAccessSettings()) {
  return EDIT_ACCESS.has(getRoleAccessLevel(role, moduleKey, settings));
}

export function canControlModule(role, moduleKey, settings = getRoleAccessSettings()) {
  return CONTROL_ACCESS.has(getRoleAccessLevel(role, moduleKey, settings));
}

export function formatAccessLevel(value) {
  const normalized = normalizeAccess(value, "HIDDEN");
  return ACCESS_LEVEL_OPTIONS.find((entry) => entry.value === normalized)?.label || "Hidden";
}
