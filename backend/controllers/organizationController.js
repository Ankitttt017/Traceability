const Plant = require("../models/Plant");
const Line = require("../models/Line");
const Machine = require("../models/Machine");
const LinePartAssignment = require("../models/LinePartAssignment");
const { ensureDefaultOrganization, ensureLinePartAssignmentSchema, normalizeCode } = require("../services/organizationService");

function toText(value) {
  return String(value || "").trim();
}

function toStatus(value) {
  return String(value || "ACTIVE").trim().toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE";
}

function normalizePartToken(value) {
  return String(value || "").trim().toUpperCase();
}

function plantResponse(row) {
  const plant = typeof row?.get === "function" ? row.get({ plain: true }) : row;
  return {
    id: plant.id,
    plantCode: plant.plant_code,
    plantName: plant.plant_name,
    location: plant.location || "",
    status: plant.status || "ACTIVE",
    isActive: plant.is_active !== false,
  };
}

function lineResponse(row) {
  const line = typeof row?.get === "function" ? row.get({ plain: true }) : row;
  return {
    id: line.id,
    plantId: line.plant_id,
    plantName: line.Plant?.plant_name || "",
    plantCode: line.Plant?.plant_code || "",
    lineCode: line.line_code,
    lineName: line.line_name,
    status: line.status || "ACTIVE",
    isActive: line.is_active !== false,
  };
}

function partResponse(row, lookups = {}) {
  const part = typeof row?.get === "function" ? row.get({ plain: true }) : row;
  const plant = lookups.plants?.get(Number(part.plant_id));
  const line = lookups.lines?.get(Number(part.line_id));
  const machine = lookups.machines?.get(Number(part.machine_id));
  const partName = normalizePartToken(part.part_name);
  const dieName = normalizePartToken(part.die_name);
  return {
    id: part.id,
    plantId: part.plant_id || null,
    plantName: plant?.plant_name || "",
    lineId: part.line_id || null,
    lineName: line?.line_name || "",
    machineId: part.machine_id || null,
    machineName: machine?.machine_name || "",
    dieCastingMachine: part.die_casting_machine || machine?.machine_name || "",
    ipAddress: part.ip_address || "",
    port: part.port !== undefined && part.port !== null ? Number(part.port) : null,
    partName,
    dieName,
    displayLabel: part.display_label || [partName, dieName].filter(Boolean).join("-"),
    status: part.status || "ACTIVE",
    isActive: part.is_active !== false,
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
  };
}

async function ensurePartAssignmentSchema() {
  await ensureLinePartAssignmentSchema();
}

async function getPartLookups() {
  const [plants, lines, machines] = await Promise.all([
    Plant.findAll({ raw: true }),
    Line.findAll({ raw: true }),
    Machine.findAll({ attributes: ["id", "machine_name"], raw: true }),
  ]);
  return {
    plants: new Map(plants.map((row) => [Number(row.id), row])),
    lines: new Map(lines.map((row) => [Number(row.id), row])),
    machines: new Map(machines.map((row) => [Number(row.id), row])),
  };
}

exports.getContext = async (_req, res) => {
  try {
    await ensureDefaultOrganization();
    await ensurePartAssignmentSchema();
    const [plants, lines, parts] = await Promise.all([
      Plant.findAll({ order: [["plant_name", "ASC"]] }),
      Line.findAll({ include: [Plant], order: [["line_name", "ASC"]] }),
      LinePartAssignment.findAll({ order: [["part_name", "ASC"], ["die_name", "ASC"]] }),
    ]);
    const lookups = await getPartLookups();
    res.json({ plants: plants.map(plantResponse), lines: lines.map(lineResponse), parts: parts.map((row) => partResponse(row, lookups)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listPlants = async (_req, res) => {
  try {
    await ensureDefaultOrganization();
    const rows = await Plant.findAll({ order: [["plant_name", "ASC"]] });
    res.json(rows.map(plantResponse));
  } catch (error) {
    console.error("[organization] listPlants failed:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.createPlant = async (req, res) => {
  try {
    const plantName = toText(req.body.plantName || req.body.plant_name);
    if (!plantName) return res.status(400).json({ error: "Plant name is required" });
    const status = toStatus(req.body.status);
    const row = await Plant.create({
      plant_code: normalizeCode(req.body.plantCode || req.body.plant_code || plantName),
      plant_name: plantName,
      location: toText(req.body.location),
      status,
      is_active: status === "ACTIVE",
    });
    res.status(201).json(plantResponse(row));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updatePlant = async (req, res) => {
  try {
    const row = await Plant.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: "Plant not found" });
    const plantName = toText(req.body.plantName || req.body.plant_name || row.plant_name);
    const status = toStatus(req.body.status || row.status);
    await row.update({
      plant_code: normalizeCode(req.body.plantCode || req.body.plant_code || row.plant_code || plantName),
      plant_name: plantName,
      location: toText(req.body.location ?? row.location),
      status,
      is_active: status === "ACTIVE",
    });
    res.json(plantResponse(row));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deletePlant = async (req, res) => {
  try {
    await ensureDefaultOrganization();
    const row = await Plant.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: "Plant not found" });
    const [lineCount, machineCount] = await Promise.all([
      Line.count({ where: { plant_id: row.id } }),
      Machine.count({ where: { plant_id: row.id } }),
    ]);
    if (lineCount > 0 || machineCount > 0) {
      return res.status(409).json({ error: "Plant is in use. Remove or move its lines/machines first." });
    }
    await row.destroy();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listLines = async (req, res) => {
  try {
    await ensureDefaultOrganization();
    const where = {};
    if (req.query.plantId) where.plant_id = Number(req.query.plantId);
    const rows = await Line.findAll({ where, include: [Plant], order: [["line_name", "ASC"]] });
    res.json(rows.map(lineResponse));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createLine = async (req, res) => {
  try {
    const defaults = await ensureDefaultOrganization();
    const plantId = Number(req.body.plantId || req.body.plant_id) || defaults.plant.id;
    const lineName = toText(req.body.lineName || req.body.line_name);
    if (!lineName) return res.status(400).json({ error: "Line name is required" });
    const status = toStatus(req.body.status);
    const row = await Line.create({
      plant_id: plantId,
      line_code: normalizeCode(req.body.lineCode || req.body.line_code || lineName),
      line_name: lineName,
      status,
      is_active: status === "ACTIVE",
    });
    res.status(201).json(lineResponse(await Line.findByPk(row.id, { include: [Plant] })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateLine = async (req, res) => {
  try {
    const row = await Line.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: "Line not found" });
    const lineName = toText(req.body.lineName || req.body.line_name || row.line_name);
    const status = toStatus(req.body.status || row.status);
    await row.update({
      plant_id: Number(req.body.plantId || req.body.plant_id) || row.plant_id,
      line_code: normalizeCode(req.body.lineCode || req.body.line_code || row.line_code || lineName),
      line_name: lineName,
      status,
      is_active: status === "ACTIVE",
    });
    res.json(lineResponse(await Line.findByPk(row.id, { include: [Plant] })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteLine = async (req, res) => {
  try {
    await ensureDefaultOrganization();
    const row = await Line.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: "Line not found" });
    const machineCount = await Machine.count({ where: { line_id: row.id } });
    if (machineCount > 0) {
      return res.status(409).json({ error: "Line is in use. Move or delete assigned machines first." });
    }
    await row.destroy();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listParts = async (req, res) => {
  try {
    await ensurePartAssignmentSchema();
    const where = {};
    if (req.query.plantId) where.plant_id = Number(req.query.plantId);
    if (req.query.lineId) where.line_id = Number(req.query.lineId);
    if (req.query.machineId) where.machine_id = Number(req.query.machineId);
    if (req.query.dieCastingMachine || req.query.die_casting_machine) where.die_casting_machine = toText(req.query.dieCastingMachine || req.query.die_casting_machine);
    if (req.query.status) {
      const status = toStatus(req.query.status);
      where.status = status;
      where.is_active = status === "ACTIVE";
    }
    const rows = await LinePartAssignment.findAll({ where, order: [["part_name", "ASC"], ["die_name", "ASC"]] });
    const lookups = await getPartLookups();
    res.json(rows.map((row) => partResponse(row, lookups)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createPart = async (req, res) => {
  try {
    await ensurePartAssignmentSchema();
    const partName = normalizePartToken(req.body.partName || req.body.part_name);
    const dieName = normalizePartToken(req.body.dieName || req.body.die_name);
    if (!partName) return res.status(400).json({ error: "Part name is required" });
    const status = toStatus(req.body.status);
    const row = await LinePartAssignment.create({
      plant_id: Number(req.body.plantId || req.body.plant_id) || null,
      line_id: Number(req.body.lineId || req.body.line_id) || null,
      machine_id: Number(req.body.machineId || req.body.machine_id) || null,
      die_casting_machine: normalizePartToken(req.body.dieCastingMachine || req.body.die_casting_machine) || null,
      ip_address: toText(req.body.ipAddress || req.body.ip_address) || null,
      port: req.body.port !== undefined && req.body.port !== null && req.body.port !== "" ? Number(req.body.port) : null,
      part_name: partName,
      die_name: dieName || null,
      display_label: toText(req.body.displayLabel || req.body.display_label) || [partName, dieName].filter(Boolean).join("-"),
      status,
      is_active: status === "ACTIVE",
    });
    res.status(201).json(partResponse(row, await getPartLookups()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updatePart = async (req, res) => {
  try {
    await ensurePartAssignmentSchema();
    const row = await LinePartAssignment.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: "Part assignment not found" });
    const partName = normalizePartToken(req.body.partName || req.body.part_name || row.part_name);
    const dieName = normalizePartToken(req.body.dieName ?? req.body.die_name ?? row.die_name);
    const status = toStatus(req.body.status || row.status);
    await row.update({
      plant_id: req.body.plantId === undefined && req.body.plant_id === undefined ? row.plant_id : (Number(req.body.plantId || req.body.plant_id) || null),
      line_id: req.body.lineId === undefined && req.body.line_id === undefined ? row.line_id : (Number(req.body.lineId || req.body.line_id) || null),
      machine_id: req.body.machineId === undefined && req.body.machine_id === undefined ? row.machine_id : (Number(req.body.machineId || req.body.machine_id) || null),
      die_casting_machine: req.body.dieCastingMachine === undefined && req.body.die_casting_machine === undefined ? row.die_casting_machine : (normalizePartToken(req.body.dieCastingMachine ?? req.body.die_casting_machine) || null),
      ip_address: req.body.ipAddress === undefined && req.body.ip_address === undefined ? row.ip_address : (toText(req.body.ipAddress ?? req.body.ip_address) || null),
      port: req.body.port === undefined ? row.port : (req.body.port !== null && req.body.port !== "" ? Number(req.body.port) : null),
      part_name: partName,
      die_name: dieName || null,
      display_label: toText(req.body.displayLabel ?? req.body.display_label ?? row.display_label) || [partName, dieName].filter(Boolean).join("-"),
      status,
      is_active: status === "ACTIVE",
    });
    res.json(partResponse(row, await getPartLookups()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deletePart = async (req, res) => {
  try {
    await ensurePartAssignmentSchema();
    const row = await LinePartAssignment.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: "Part assignment not found" });
    await row.destroy();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
