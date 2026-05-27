const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { AppError } = require("../middleware/errorHandler");

class AuthService {
  async register(data) {
    const { username, password, role } = data;
    if (!username || !password || !role) {
      throw new AppError("username, password, and role are required", 400);
    }
    const user = await User.create({ username, password, role });
    return {
      message: "User created",
      user: { id: user.id, username, role: user.role }
    };
  }

  async login(data) {
    const { username, password } = data;
    if (!username || !password) {
      throw new AppError("username and password are required", 400);
    }

    const user = await User.findOne({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new AppError("Invalid credentials", 401);
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || "secret_key",
      { expiresIn: "1d" }
    );

    return { token, user: { id: user.id, username, role: user.role } };
  }
}

module.exports = new AuthService();
