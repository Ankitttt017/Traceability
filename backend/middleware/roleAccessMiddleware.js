const { canRoleAccess, getRoleAccessSettings } = require("../services/roleAccessService");
const User = require("../models/User");

const EDIT_ACCESS = new Set(["VIEW_EDIT", "VIEW_CONTROL"]);
const CONTROL_ACCESS = new Set(["VIEW_CONTROL"]);

function normalizeRule(rule) {
  if (!rule) return null;
  if (typeof rule === "string") {
    return { moduleKey: rule, mode: "view" };
  }
  return {
    moduleKey: String(rule.moduleKey || "").trim(),
    mode: String(rule.mode || "view").trim().toLowerCase(),
  };
}

function buildForbiddenMessage(rules = []) {
  const summary = rules.map((rule) => `${rule.moduleKey}:${rule.mode}`).join(" or ");
  return summary ? `Access denied. Required permission: ${summary}` : "Access denied.";
}

function parsePageAccessOverrides(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function canOverrideAccess(level, mode = "view") {
  const normalizedLevel = String(level || "").trim().toUpperCase();
  switch (String(mode || "view").trim().toLowerCase()) {
    case "edit":
      return EDIT_ACCESS.has(normalizedLevel);
    case "control":
      return CONTROL_ACCESS.has(normalizedLevel);
    case "operate":
    case "view":
    default:
      return normalizedLevel !== "HIDDEN";
  }
}

async function getUserOverrides(userId) {
  if (!userId) return {};
  const user = await User.findByPk(userId, { attributes: ["page_access_overrides"] });
  return parsePageAccessOverrides(user?.page_access_overrides);
}

async function enforceRules(req, res, next, rules = []) {
  try {
    const settings = await getRoleAccessSettings();
    const role = String(req.user?.accessRole || req.user?.role || "").trim();
    const normalizedRules = rules.map(normalizeRule).filter((rule) => rule?.moduleKey);
    const overrides = await getUserOverrides(req.user?.id);
    const allowed = normalizedRules.some((rule) =>
      Object.prototype.hasOwnProperty.call(overrides, rule.moduleKey)
        ? canOverrideAccess(overrides[rule.moduleKey], rule.mode)
        : canRoleAccess(role, rule.moduleKey, rule.mode, settings)
    );

    if (!allowed) {
      return res.status(403).json({
        error: buildForbiddenMessage(normalizedRules),
      });
    }

    return next();
  } catch (_error) {
    return res.status(500).json({
      error: "Unable to verify role access settings",
    });
  }
}

function requireModuleAccess(moduleKey, mode = "view") {
  return (req, res, next) => enforceRules(req, res, next, [{ moduleKey, mode }]);
}

function requireAnyModuleAccess(rules = []) {
  return (req, res, next) => enforceRules(req, res, next, rules);
}

module.exports = {
  requireModuleAccess,
  requireAnyModuleAccess,
};
