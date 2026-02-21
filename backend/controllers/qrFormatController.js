const QrFormatRule = require("../models/QrFormatRule");

function toResponse(rule) {
  return {
    id: rule.id,
    formatName: rule.format_name,
    regexPattern: rule.regex_pattern,
    sampleValue: rule.sample_value,
    description: rule.description,
    isActive: rule.is_active,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

exports.listRules = async (_req, res) => {
  try {
    const rules = await QrFormatRule.findAll({ order: [["createdAt", "DESC"]] });
    res.json(rules.map(toResponse));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createRule = async (req, res) => {
  try {
    const { formatName, name, regexPattern, sampleValue, description, isActive } = req.body;
    const normalizedName = String(formatName ?? name ?? "").trim();
    if (!normalizedName || !regexPattern) {
      return res.status(400).json({ error: "formatName and regexPattern are required" });
    }

    let compiled;
    try {
      compiled = new RegExp(regexPattern);
    } catch (_e) {
      return res.status(400).json({ error: "Invalid regex pattern" });
    }

    if (sampleValue && !compiled.test(sampleValue)) {
      return res.status(400).json({ error: "sampleValue does not match regexPattern" });
    }

    if (isActive) {
      await QrFormatRule.update({ is_active: false }, { where: { is_active: true } });
    }

    const created = await QrFormatRule.create({
      format_name: normalizedName,
      regex_pattern: regexPattern,
      sample_value: sampleValue || null,
      description: description || null,
      is_active: Boolean(isActive),
    });

    res.status(201).json(toResponse(created));
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "Rule name already exists" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.updateRule = async (req, res) => {
  try {
    const rule = await QrFormatRule.findByPk(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    const regexPattern = req.body.regexPattern ?? rule.regex_pattern;
    let compiled;
    try {
      compiled = new RegExp(regexPattern);
    } catch (_e) {
      return res.status(400).json({ error: "Invalid regex pattern" });
    }

    const sampleValue = req.body.sampleValue ?? rule.sample_value;
    if (sampleValue && !compiled.test(sampleValue)) {
      return res.status(400).json({ error: "sampleValue does not match regexPattern" });
    }

    const isActive = req.body.isActive === undefined ? rule.is_active : Boolean(req.body.isActive);
    if (isActive) {
      await QrFormatRule.update({ is_active: false }, { where: { is_active: true } });
    }

    await rule.update({
      format_name: req.body.formatName
        ? String(req.body.formatName).trim()
        : req.body.name
          ? String(req.body.name).trim()
          : rule.format_name,
      regex_pattern: regexPattern,
      sample_value: sampleValue || null,
      description: req.body.description ?? rule.description,
      is_active: isActive,
    });

    res.json(toResponse(rule));
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "Rule name already exists" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.deleteRule = async (req, res) => {
  try {
    const rule = await QrFormatRule.findByPk(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await rule.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
