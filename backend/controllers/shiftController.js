const { Sequelize } = require("sequelize");
const sequelize = require("../config/db");
const Shift = require("../models/Shift");
const { normalizeTimeValue } = require("../utils/time");

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

async function ensureScopeColumns() {
  await sequelize.query(`
    IF COL_LENGTH('Shifts', 'plant_id') IS NULL
      ALTER TABLE [Shifts] ADD [plant_id] INT NULL;
  `);
  await sequelize.query(`
    IF COL_LENGTH('Shifts', 'line_id') IS NULL
      ALTER TABLE [Shifts] ADD [line_id] INT NULL;
  `);
}

function toPayload(body = {}) {
  return {
    plant_id: toInt(body.plantId ?? body.plant_id),
    line_id: toInt(body.lineId ?? body.line_id),
    shift_name: String(body.shiftName ?? body.shift_name ?? "").trim(),
    shift_code: String(body.shiftCode ?? body.shift_code ?? "")
      .trim()
      .toUpperCase(),
    start_time: normalizeTimeValue(body.startTime ?? body.start_time, { includeSeconds: true }),
    end_time: normalizeTimeValue(body.endTime ?? body.end_time, { includeSeconds: true }),
    is_active:
      body.isActive === undefined && body.is_active === undefined
        ? true
        : Boolean(body.isActive ?? body.is_active),
  };
}

function toResponse(shift) {
  return {
    id: shift.id,
    plantId: shift.plant_id || null,
    lineId: shift.line_id || null,
    shiftName: shift.shift_name,
    shiftCode: shift.shift_code,
    startTime: normalizeTimeValue(shift.start_time, { includeSeconds: true }),
    endTime: normalizeTimeValue(shift.end_time, { includeSeconds: true }),
    isActive: shift.is_active,
    createdAt: shift.createdAt,
    updatedAt: shift.updatedAt,
  };
}

function validatePayload(payload) {
  const missing = [];
  if (!payload.shift_name) {
    missing.push("shiftName");
  }
  if (!payload.shift_code) {
    missing.push("shiftCode");
  }
  if (!payload.start_time) {
    missing.push("startTime");
  }
  if (!payload.end_time) {
    missing.push("endTime");
  }
  return missing;
}

function handleError(error, res) {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ error: "Shift code already exists" });
  }
  if (error instanceof Sequelize.ValidationError) {
    return res.status(400).json({
      error: "Validation failed",
      details: error.errors.map((entry) => entry.message),
    });
  }
  return res.status(500).json({ error: error.message });
}

exports.listShifts = async (req, res) => {
  try {
    await ensureScopeColumns();
    const where = {};
    const plantId = toInt(req.query.plantId ?? req.query.plant_id);
    const lineId = toInt(req.query.lineId ?? req.query.line_id);
    if (plantId) where.plant_id = plantId;
    if (lineId) where.line_id = lineId;
    const rows = await Shift.findAll({
      where,
      order: [["start_time", "ASC"]],
    });
    res.json(rows.map(toResponse));
  } catch (error) {
    handleError(error, res);
  }
};

exports.createShift = async (req, res) => {
  try {
    await ensureScopeColumns();
    const payload = toPayload(req.body);
    const missing = validatePayload(payload);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Required fields: ${missing.join(", ")}` });
    }

    const created = await Shift.create(payload);
    res.status(201).json(toResponse(created));
  } catch (error) {
    handleError(error, res);
  }
};

exports.updateShift = async (req, res) => {
  try {
    await ensureScopeColumns();
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) {
      return res.status(404).json({ error: "Shift not found" });
    }

    const payload = toPayload(req.body);
    const missing = validatePayload(payload);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Required fields: ${missing.join(", ")}` });
    }

    await shift.update(payload);
    res.json(toResponse(shift));
  } catch (error) {
    handleError(error, res);
  }
};

exports.deleteShift = async (req, res) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) {
      return res.status(404).json({ error: "Shift not found" });
    }
    await shift.destroy();
    res.status(204).send();
  } catch (error) {
    handleError(error, res);
  }
};
