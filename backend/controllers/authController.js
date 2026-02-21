const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

exports.register = async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const user = await User.create({ username, password, role });
    res.status(201).json({ message: "User created", user: { id: user.id, username, role } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || "secret_key", {
      expiresIn: "1d",
    });
    res.json({ token, user: { id: user.id, username, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
