const { canRoleAccess, getRoleAccessSettings } = require("../services/roleAccessService");

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

async function enforceRules(req, res, next, rules = []) {
  try {
    const settings = await getRoleAccessSettings();
    const role = String(req.user?.role || "").trim();
    const normalizedRules = rules.map(normalizeRule).filter((rule) => rule?.moduleKey);
    const allowed = normalizedRules.some((rule) =>
      canRoleAccess(role, rule.moduleKey, rule.mode, settings)
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
