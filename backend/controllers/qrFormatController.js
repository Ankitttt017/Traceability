const QrFormatRule = require("../models/QrFormatRule");
const sequelize = require("../config/db");
const { compileQrPattern, testQrPattern } = require("../utils/qrRegex");

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

async function ensureScopeColumns() {
  await sequelize.query(`
    IF COL_LENGTH('QrFormatRules', 'plant_id') IS NULL
      ALTER TABLE [QrFormatRules] ADD [plant_id] INT NULL;
  `);
  await sequelize.query(`
    IF COL_LENGTH('QrFormatRules', 'line_id') IS NULL
      ALTER TABLE [QrFormatRules] ADD [line_id] INT NULL;
  `);
  await sequelize.query(`
    IF COL_LENGTH('QrFormatRules', 'part_name') IS NULL
      ALTER TABLE [QrFormatRules] ADD [part_name] NVARCHAR(255) NULL;
  `);
  await sequelize.query(`
    IF COL_LENGTH('QrFormatRules', 'die_name') IS NULL
      ALTER TABLE [QrFormatRules] ADD [die_name] NVARCHAR(255) NULL;
  `);
}

function normalizePartToken(value) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}

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
    plantId: rule.plant_id || null,
    lineId: rule.line_id || null,
    formatName: rule.format_name,
    modelCode: rule.model_code,
    partName: rule.part_name,
    dieName: rule.die_name,
    regexPattern: rule.regex_pattern,
    stationScope: rule.station_scope,
    sampleValue: rule.sample_value,
    description: rule.description,
    isActive: rule.is_active,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

exports.listRules = async (req, res) => {
  try {
    await ensureScopeColumns();
    const where = {};
    const plantId = toInt(req.query.plantId ?? req.query.plant_id);
    const lineId = toInt(req.query.lineId ?? req.query.line_id);
    const partName = normalizePartToken(req.query.partName ?? req.query.part_name);
    const dieName = normalizePartToken(req.query.dieName ?? req.query.die_name);
    if (plantId) where.plant_id = plantId;
    if (lineId) where.line_id = lineId;
    if (partName) where.part_name = partName;
    if (dieName) where.die_name = dieName;
    const rules = await QrFormatRule.findAll({ where, order: [["createdAt", "DESC"]] });
    res.json(rules.map(toResponse));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createRule = async (req, res) => {
  try {
    await ensureScopeColumns();
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
      plant_id: toInt(req.body.plantId ?? req.body.plant_id),
      line_id: toInt(req.body.lineId ?? req.body.line_id),
      format_name: normalizedName,
      model_code: normalizedModelCode || null,
      part_name: normalizePartToken(req.body.partName ?? req.body.part_name),
      die_name: normalizePartToken(req.body.dieName ?? req.body.die_name),
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
    await ensureScopeColumns();
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
    const partName = req.body.partName === undefined && req.body.part_name === undefined ? rule.part_name : normalizePartToken(req.body.partName ?? req.body.part_name);
    const dieName = req.body.dieName === undefined && req.body.die_name === undefined ? rule.die_name : normalizePartToken(req.body.dieName ?? req.body.die_name);

    await rule.update({
      plant_id: req.body.plantId === undefined && req.body.plant_id === undefined ? rule.plant_id : toInt(req.body.plantId ?? req.body.plant_id),
      line_id: req.body.lineId === undefined && req.body.line_id === undefined ? rule.line_id : toInt(req.body.lineId ?? req.body.line_id),
      format_name: req.body.formatName
        ? String(req.body.formatName).trim()
        : req.body.name
          ? String(req.body.name).trim()
          : rule.format_name,
      model_code: modelCode || null,
      part_name: partName || null,
      die_name: dieName || null,
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
