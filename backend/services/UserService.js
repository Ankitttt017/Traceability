const { Sequelize } = require("sequelize");
const User = require("../models/User");
const { AppError } = require("../middleware/errorHandler");

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
    const { username, password, role, status } = data;
    if (!username || !password || !role) {
      throw new AppError("username, password and role are required", 400);
    }
    const user = await User.create({ username, password, role, status });
    return this.sanitizeUser(user);
  }

  async updateUser(id, data) {
    const user = await User.findByPk(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    const updates = {
      username: data.username,
      role: data.role,
      status: data.status,
    };

    if (data.password && String(data.password).trim()) {
      updates.password = data.password;
    }

    await user.update(updates);
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
