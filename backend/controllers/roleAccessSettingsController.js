const RoleAccessSetting = require("../models/RoleAccessSetting");

const ACCESS_LEVELS = new Set(["HIDDEN", "VIEW", "VIEW_EDIT", "VIEW_CONTROL"]);

const DEFAULT_ROLE_ACCESS_SETTINGS = {
  dashboard: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  production: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  io_monitor: { admin: "VIEW_CONTROL", engineer: "VIEW_CONTROL", supervisor: "VIEW", operator: "VIEW" },
  part_journey: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  process_flow: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  operator_view: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  packing: { admin: "VIEW", engineer: "VIEW", supervisor: "VIEW", operator: "VIEW" },
  packing_management: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN" },
  master_settings: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  machines: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN" },
  plc_config: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN" },
  scanners: { admin: "VIEW_EDIT", engineer: "VIEW_EDIT", supervisor: "VIEW", operator: "HIDDEN" },
  shifts: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  qr_rules: { admin: "VIEW_EDIT", engineer: "VIEW", supervisor: "VIEW", operator: "HIDDEN" },
  users: { admin: "VIEW_EDIT", engineer: "HIDDEN", supervisor: "HIDDEN", operator: "HIDDEN" },
};

function normalizeModuleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeAccessLevel(value, fallback = "HIDDEN") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return ACCESS_LEVELS.has(normalized) ? normalized : fallback;
}

function normalizeInputMap(rawSettings = {}) {
  if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    return {};
  }

  return Object.entries(rawSettings).reduce((acc, [rawKey, rawValue]) => {
    const moduleKey = normalizeModuleKey(rawKey);
    if (!moduleKey || !rawValue || typeof rawValue !== "object") {
      return acc;
    }

    const defaults = DEFAULT_ROLE_ACCESS_SETTINGS[moduleKey] || {
      admin: "VIEW_EDIT",
      engineer: "VIEW",
      supervisor: "VIEW",
      operator: "HIDDEN",
    };

    acc[moduleKey] = {
      admin: normalizeAccessLevel(rawValue.admin, defaults.admin),
      engineer: normalizeAccessLevel(rawValue.engineer, defaults.engineer),
      supervisor: normalizeAccessLevel(rawValue.supervisor, defaults.supervisor),
      operator: normalizeAccessLevel(rawValue.operator, defaults.operator),
    };
    return acc;
  }, {});
}

function rowsToMap(rows = []) {
  const merged = { ...DEFAULT_ROLE_ACCESS_SETTINGS };
  for (const row of rows) {
    const moduleKey = normalizeModuleKey(row.module_key);
    if (!moduleKey) {
      continue;
    }
    merged[moduleKey] = {
      admin: normalizeAccessLevel(row.admin_access, merged[moduleKey]?.admin || "VIEW_EDIT"),
      engineer: normalizeAccessLevel(row.engineer_access, merged[moduleKey]?.engineer || "VIEW"),
      supervisor: normalizeAccessLevel(row.supervisor_access, merged[moduleKey]?.supervisor || "VIEW"),
      operator: normalizeAccessLevel(row.operator_access, merged[moduleKey]?.operator || "HIDDEN"),
    };
  }
  return merged;
}

async function ensureDefaultModules() {
  const moduleKeys = Object.keys(DEFAULT_ROLE_ACCESS_SETTINGS);
  const existingRows = await RoleAccessSetting.findAll({
    where: { module_key: moduleKeys },
    attributes: ["module_key"],
  });

  const existing = new Set(existingRows.map((row) => normalizeModuleKey(row.module_key)));
  const missing = moduleKeys.filter((key) => !existing.has(key));
  if (missing.length === 0) {
    return;
  }

  await Promise.all(
    missing.map((moduleKey) => {
      const defaults = DEFAULT_ROLE_ACCESS_SETTINGS[moduleKey];
      return RoleAccessSetting.create({
        module_key: moduleKey,
        admin_access: defaults.admin,
        engineer_access: defaults.engineer,
        supervisor_access: defaults.supervisor,
        operator_access: defaults.operator,
      });
    })
  );
}

exports.getSettings = async (_req, res) => {
  try {
    await ensureDefaultModules();
    const rows = await RoleAccessSetting.findAll({
      order: [["module_key", "ASC"]],
    });
    res.json(rowsToMap(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const payload = normalizeInputMap(req.body?.settings || req.body);
    const modules = Object.keys(payload);

    if (modules.length === 0) {
      return res.status(400).json({ error: "At least one module setting is required" });
    }

    await Promise.all(
      modules.map((moduleKey) =>
        RoleAccessSetting.upsert({
          module_key: moduleKey,
          admin_access: payload[moduleKey].admin,
          engineer_access: payload[moduleKey].engineer,
          supervisor_access: payload[moduleKey].supervisor,
          operator_access: payload[moduleKey].operator,
          updated_by: req.user?.id || null,
        })
      )
    );

    await ensureDefaultModules();
    const rows = await RoleAccessSetting.findAll({
      order: [["module_key", "ASC"]],
    });

    res.json({
      message: "Role access settings saved",
      settings: rowsToMap(rows),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
