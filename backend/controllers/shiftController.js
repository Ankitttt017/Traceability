const { Sequelize } = require("sequelize");
const Shift = require("../models/Shift");
const { normalizeTimeValue } = require("../utils/time");

function toPayload(body = {}) {
  return {
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

exports.listShifts = async (_req, res) => {
  try {
    const rows = await Shift.findAll({
      order: [["start_time", "ASC"]],
    });
    res.json(rows.map(toResponse));
  } catch (error) {
    handleError(error, res);
  }
};

exports.createShift = async (req, res) => {
  try {
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
