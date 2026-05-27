const QrFormatRule = require("../models/QrFormatRule");
const { compileQrPattern, testQrPattern } = require("../utils/qrRegex");

function normalizeStationScope(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const stations = text
    .split(/\r?\n|[,;|]/)
    .map((entry) => String(entry || "").trim().toUpperCase())
    .filter(Boolean);
  if (stations.length === 0) {
    return null;
  }
  return Array.from(new Set(stations)).join(",");
}

function normalizeModelCode(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const models = text
    .split(/\r?\n|[,;|]/)
    .map((entry) => String(entry || "").trim().toUpperCase())
    .filter(Boolean);
  if (models.length === 0) {
    return null;
  }
  return Array.from(new Set(models)).join(", ");
}

function toResponse(rule) {
  return {
    id: rule.id,
    formatName: rule.format_name,
    modelCode: rule.model_code,
    regexPattern: rule.regex_pattern,
    stationScope: rule.station_scope,
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
    const { formatName, name, modelCode, regexPattern, stationScope, sampleValue, description, isActive } = req.body;
    const normalizedName = String(formatName ?? name ?? "").trim();
    const normalizedModelCode = normalizeModelCode(modelCode);
    const normalizedPattern = String(regexPattern || "").trim();
    const normalizedStationScope = normalizeStationScope(stationScope);
    if (!normalizedName || !normalizedPattern) {
      return res.status(400).json({ error: "formatName and regexPattern are required" });
    }

    try {
      compileQrPattern(normalizedPattern);
    } catch (_e) {
      return res.status(400).json({
        error: "Invalid regex pattern. Use valid JS regex. For any format use * . For multiple formats use || or new line.",
      });
    }

    if (sampleValue && !testQrPattern(normalizedPattern, sampleValue)) {
      return res.status(400).json({ error: "sampleValue does not match regexPattern" });
    }

    const created = await QrFormatRule.create({
      format_name: normalizedName,
      model_code: normalizedModelCode || null,
      regex_pattern: normalizedPattern,
      station_scope: normalizedStationScope,
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

    const regexPattern = String(req.body.regexPattern ?? rule.regex_pattern ?? "").trim();
    try {
      compileQrPattern(regexPattern);
    } catch (_e) {
      return res.status(400).json({
        error: "Invalid regex pattern. Use valid JS regex. For any format use * . For multiple formats use || or new line.",
      });
    }

    const sampleValue = req.body.sampleValue ?? rule.sample_value;
    if (sampleValue && !testQrPattern(regexPattern, sampleValue)) {
      return res.status(400).json({ error: "sampleValue does not match regexPattern" });
    }

    const isActive = req.body.isActive === undefined ? rule.is_active : Boolean(req.body.isActive);
    const stationScope = req.body.stationScope === undefined ? rule.station_scope : normalizeStationScope(req.body.stationScope);
    const modelCode = req.body.modelCode === undefined ? rule.model_code : normalizeModelCode(req.body.modelCode);

    await rule.update({
      format_name: req.body.formatName
        ? String(req.body.formatName).trim()
        : req.body.name
          ? String(req.body.name).trim()
          : rule.format_name,
      model_code: modelCode || null,
      regex_pattern: regexPattern,
      station_scope: stationScope,
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
