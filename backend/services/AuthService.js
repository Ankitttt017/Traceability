const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { AppError } = require("../middleware/errorHandler");

const LEGACY_ROLE_MAP = { Admin: "Super Admin", Other: "Viewer" };
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

function userPayload(user) {
  const role = normalizeRole(user.access_role || user.role);
  let pageAccessOverrides = {};
  try {
    const parsed = JSON.parse(String(user.page_access_overrides || "{}"));
    pageAccessOverrides = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    pageAccessOverrides = {};
  }
  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    role,
    legacyRole: user.role,
    plantId: user.plant_id,
    employeeCode: user.employee_code,
    email: user.email,
    phoneNumber: user.phone_number,
    profileImageUrl: user.profile_image_url,
    pageAccessOverrides,
    status: user.status,
  };
}

class AuthService {
  async register(data) {
    const { username, password } = data;
    const role = normalizeRole(data.role);
    if (!username || !password || !role) {
      throw new AppError("username, password, and role are required", 400);
    }
    const user = await User.create({ username, password, role: toLegacyRole(role), access_role: role });
    return {
      message: "User created",
      user: userPayload(user)
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
      { id: user.id, role: user.role, accessRole: normalizeRole(user.access_role || user.role) },
      process.env.JWT_SECRET || "secret_key",
      { expiresIn: "1d" }
    );

    return { token, user: userPayload(user) };
  }
}

module.exports = new AuthService();
