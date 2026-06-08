const { Sequelize } = require("sequelize");
const User = require("../models/User");
const { AppError } = require("../middleware/errorHandler");
const { ensureUserRoleSchema } = require("./machineSchemaService");

const ALLOWED_ROLES = new Set(["Admin", "Engineer", "Supervisor", "Operator", "Other"]);
const ALLOWED_STATUS = new Set(["ACTIVE", "INACTIVE"]);

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
      username: user.username,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async getAllUsers() {
    const users = await User.findAll({
      attributes: { exclude: ["password"] },
      order: [["id", "ASC"]],
    });
    return users.map(this.sanitizeUser);
  }

  async createUser(data) {
    const username = String(data.username || "").trim();
    const password = String(data.password || "");
    const role = String(data.role || "").trim();
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
    const user = await retryWithUserRoleSchemaRepair(() =>
      User.create({ username, password, role, status })
    );
    return this.sanitizeUser(user);
  }

  async updateUser(id, data) {
    const user = await User.findByPk(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    const updates = {
      username: data.username ? String(data.username).trim() : user.username,
      role: data.role ? String(data.role).trim() : user.role,
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
