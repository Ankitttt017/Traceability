const { Sequelize } = require("sequelize");
const User = require("../models/User");
const { AppError } = require("../middleware/errorHandler");
const { ensureUserRoleSchema } = require("./machineSchemaService");

const USER_ROLES = [
  "Super Admin",
  "Company Admin",
  "Plant Admin",
  "Production Manager",
  "Quality Manager",
  "Maintenance",
  "Engineer",
  "Supervisor",
  "Operator",
  "Auditor",
  "Viewer",
];
const LEGACY_ROLE_MAP = { Admin: "Super Admin", Other: "Viewer" };
const ALLOWED_ROLES = new Set([...USER_ROLES, ...Object.keys(LEGACY_ROLE_MAP)]);
const ALLOWED_STATUS = new Set(["ACTIVE", "INACTIVE"]);
const ALLOWED_ACCESS_LEVELS = new Set(["HIDDEN", "VIEW", "VIEW_EDIT", "VIEW_CONTROL"]);
const LEGACY_ROLE_BUCKET = {
  "Super Admin": "Admin",
  "Company Admin": "Admin",
  "Plant Admin": "Admin",
  "Production Manager": "Engineer",
  "Quality Manager": "Engineer",
  Maintenance: "Engineer",
  Engineer: "Engineer",
  Supervisor: "Supervisor",
  Operator: "Operator",
  Auditor: "Other",
  Viewer: "Other",
};

function normalizeRole(role) {
  const cleanRole = String(role || "").trim();
  return LEGACY_ROLE_MAP[cleanRole] || cleanRole;
}

function toLegacyRole(role) {
  return LEGACY_ROLE_BUCKET[normalizeRole(role)] || "Operator";
}

function cleanOptionalString(value) {
  const cleanValue = String(value || "").trim();
  return cleanValue || null;
}

function getDisplayEmail(user) {
  const email = cleanOptionalString(user?.email);
  if (email) return email;
  const username = cleanOptionalString(user?.username);
  return username && username.includes("@") ? username : null;
}

function parsePageAccessOverrides(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeModuleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizePageAccessOverrides(value) {
  const source = parsePageAccessOverrides(value);
  const normalized = {};
  Object.entries(source).forEach(([moduleKey, accessLevel]) => {
    const cleanModuleKey = normalizeModuleKey(moduleKey);
    const cleanAccessLevel = String(accessLevel || "").trim().toUpperCase();
    if (cleanModuleKey && ALLOWED_ACCESS_LEVELS.has(cleanAccessLevel)) {
      normalized[cleanModuleKey] = cleanAccessLevel;
    }
  });
  return normalized;
}

function serializePageAccessOverrides(value) {
  const normalized = normalizePageAccessOverrides(value);
  return Object.keys(normalized).length ? JSON.stringify(normalized) : null;
}

function isLegacyUserRoleConstraintError(error) {
  const messages = [
    error?.message,
    error?.parent?.message,
    error?.original?.message,
  ]
    .filter(Boolean)
    .map((entry) => String(entry).toLowerCase());

  return messages.some(
    (message) =>
      message.includes("check constraint") &&
      message.includes("users") &&
      message.includes("role")
  );
}

async function retryWithUserRoleSchemaRepair(task) {
  try {
    return await task();
  } catch (error) {
    if (!isLegacyUserRoleConstraintError(error)) {
      throw error;
    }

    await ensureUserRoleSchema();

    try {
      return await task();
    } catch (retryError) {
      if (isLegacyUserRoleConstraintError(retryError)) {
        throw new AppError(
          "User role constraint is outdated in the database. Restart backend once so role schema repair can complete.",
          500
        );
      }
      throw retryError;
    }
  }
}

class UserService {
  sanitizeUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      fullName: user.full_name,
      username: user.username,
      role: normalizeRole(user.access_role || user.role),
      legacyRole: user.role,
      plantId: user.plant_id,
      employeeCode: user.employee_code,
      email: getDisplayEmail(user),
      phoneNumber: user.phone_number,
      profileImageUrl: user.profile_image_url,
      pageAccessOverrides: normalizePageAccessOverrides(user.page_access_overrides),
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async getAllUsers() {
    await ensureUserRoleSchema();
    const users = await User.findAll({
      attributes: { exclude: ["password"] },
      order: [["id", "ASC"]],
    });
    return users.map(this.sanitizeUser);
  }

  async createUser(data) {
    await ensureUserRoleSchema();
    const username = String(data.username || "").trim();
    const password = String(data.password || "");
    const role = normalizeRole(data.role);
    const status = String(data.status || "ACTIVE").trim().toUpperCase();
    if (!username || !password || !role) {
      throw new AppError("username, password and role are required", 400);
    }
    if (!ALLOWED_ROLES.has(role)) {
      throw new AppError("Invalid role supplied", 400);
    }
    if (!ALLOWED_STATUS.has(status)) {
      throw new AppError("Invalid status supplied", 400);
    }
    const plantId = Number(data.plantId || data.plant_id || 0) || null;
    const user = await retryWithUserRoleSchemaRepair(() =>
      User.create({
        full_name: cleanOptionalString(data.fullName || data.full_name),
        username,
        password,
        role: toLegacyRole(role),
        access_role: role,
        plant_id: plantId,
        employee_code: cleanOptionalString(data.employeeCode || data.employee_code),
        email: cleanOptionalString(data.email),
        phone_number: cleanOptionalString(data.phoneNumber || data.phone_number),
        profile_image_url: cleanOptionalString(data.profileImageUrl || data.profile_image_url),
        page_access_overrides: serializePageAccessOverrides(data.pageAccessOverrides || data.page_access_overrides),
        status,
      })
    );
    return this.sanitizeUser(user);
  }

  async updateUser(id, data) {
    await ensureUserRoleSchema();
    const user = await User.findByPk(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    const updates = {
      full_name: Object.prototype.hasOwnProperty.call(data, "fullName") || Object.prototype.hasOwnProperty.call(data, "full_name")
        ? cleanOptionalString(data.fullName || data.full_name)
        : user.full_name,
      username: data.username ? String(data.username).trim() : user.username,
      role: data.role ? toLegacyRole(data.role) : user.role,
      access_role: data.role ? normalizeRole(data.role) : (user.access_role || normalizeRole(user.role)),
      plant_id: Object.prototype.hasOwnProperty.call(data, "plantId") || Object.prototype.hasOwnProperty.call(data, "plant_id")
        ? (Number(data.plantId || data.plant_id || 0) || null)
        : user.plant_id,
      employee_code: Object.prototype.hasOwnProperty.call(data, "employeeCode") || Object.prototype.hasOwnProperty.call(data, "employee_code")
        ? cleanOptionalString(data.employeeCode || data.employee_code)
        : user.employee_code,
      email: Object.prototype.hasOwnProperty.call(data, "email")
        ? cleanOptionalString(data.email)
        : user.email,
      phone_number: Object.prototype.hasOwnProperty.call(data, "phoneNumber") || Object.prototype.hasOwnProperty.call(data, "phone_number")
        ? cleanOptionalString(data.phoneNumber || data.phone_number)
        : user.phone_number,
      profile_image_url: Object.prototype.hasOwnProperty.call(data, "profileImageUrl") || Object.prototype.hasOwnProperty.call(data, "profile_image_url")
        ? cleanOptionalString(data.profileImageUrl || data.profile_image_url)
        : user.profile_image_url,
      page_access_overrides: Object.prototype.hasOwnProperty.call(data, "pageAccessOverrides") || Object.prototype.hasOwnProperty.call(data, "page_access_overrides")
        ? serializePageAccessOverrides(data.pageAccessOverrides || data.page_access_overrides)
        : user.page_access_overrides,
      status: data.status ? String(data.status).trim().toUpperCase() : user.status,
    };

    if (!updates.username) {
      throw new AppError("username is required", 400);
    }
    if (!ALLOWED_ROLES.has(updates.role)) {
      throw new AppError("Invalid role supplied", 400);
    }
    if (!ALLOWED_STATUS.has(updates.status)) {
      throw new AppError("Invalid status supplied", 400);
    }

    if (data.password && String(data.password).trim()) {
      updates.password = data.password;
    }

    await retryWithUserRoleSchemaRepair(() => user.update(updates));
    return this.sanitizeUser(user);
  }

  async deleteUser(id) {
    const user = await User.findByPk(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    await user.destroy();
    return true;
  }
}

module.exports = new UserService();
