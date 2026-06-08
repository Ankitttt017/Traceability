const RoleAccessSetting = require("../models/RoleAccessSetting");
const {
  getRoleAccessSettings,
  invalidateRoleAccessCache,
  normalizeSettingsInput,
} = require("../services/roleAccessService");

exports.getSettings = async (_req, res) => {
  try {
    const settings = await getRoleAccessSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const payload = normalizeSettingsInput(req.body?.settings || req.body);
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
          other_access: payload[moduleKey].other,
          updated_by: req.user?.id || null,
        })
      )
    );

    invalidateRoleAccessCache();
    const settings = await getRoleAccessSettings({ forceRefresh: true });

    res.json({
      message: "Role access settings saved",
      settings,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
