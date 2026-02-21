const { Sequelize } = require("sequelize");
const User = require("../models/User");

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function handleSequelizeError(error, res) {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ error: "Username already exists" });
  }

  if (error instanceof Sequelize.ValidationError) {
    return res.status(400).json({
      error: "Validation failed",
      details: error.errors.map((entry) => entry.message),
    });
  }

  return res.status(500).json({ error: error.message });
}

exports.getUsers = async (_req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ["password"] },
      order: [["id", "ASC"]],
    });
    res.json(users.map(sanitizeUser));
  } catch (error) {
    handleSequelizeError(error, res);
  }
};

exports.createUser = async (req, res) => {
  try {
    const { username, password, role, status } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ error: "username, password and role are required" });
    }

    const user = await User.create({ username, password, role, status });
    res.status(201).json(sanitizeUser(user));
  } catch (error) {
    handleSequelizeError(error, res);
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updates = {
      username: req.body.username,
      role: req.body.role,
      status: req.body.status,
    };

    if (req.body.password && String(req.body.password).trim()) {
      updates.password = req.body.password;
    }

    await user.update(updates);
    res.json(sanitizeUser(user));
  } catch (error) {
    handleSequelizeError(error, res);
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await user.destroy();
    res.status(204).send();
  } catch (error) {
    handleSequelizeError(error, res);
  }
};
