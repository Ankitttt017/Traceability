const Plant = require("../models/Plant");
const Line = require("../models/Line");
const Machine = require("../models/Machine");
const LinePartAssignment = require("../models/LinePartAssignment");
const { Op } = require("sequelize");
const sequelize = require("../config/db");

const DEFAULT_PLANT = {
  plant_code: "BAWAL",
  plant_name: "Bawal",
  location: "Bawal",
  status: "ACTIVE",
  is_active: true,
};

const DEFAULT_LINE = {
  line_code: "OIL_PAN_K12",
  line_name: "OIL PAN K-12",
  status: "ACTIVE",
  is_active: true,
};

let schemaReadyPromise = null;

function normalizeCode(value, fallback = "") {
  return String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function ensureOrganizationSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await sequelize.query(`
        IF OBJECT_ID('dbo.Plants', 'U') IS NULL
        BEGIN
          CREATE TABLE [Plants] (
            [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            [plant_code] NVARCHAR(255) NOT NULL,
            [plant_name] NVARCHAR(255) NOT NULL,
            [location] NVARCHAR(255) NULL,
            [status] NVARCHAR(20) NOT NULL CONSTRAINT [DF_Plants_status] DEFAULT 'ACTIVE',
            [is_active] BIT NOT NULL CONSTRAINT [DF_Plants_is_active] DEFAULT 1,
            [createdAt] DATETIMEOFFSET NOT NULL CONSTRAINT [DF_Plants_createdAt] DEFAULT SYSDATETIMEOFFSET(),
            [updatedAt] DATETIMEOFFSET NOT NULL CONSTRAINT [DF_Plants_updatedAt] DEFAULT SYSDATETIMEOFFSET()
          );
        END;
      `);
      await sequelize.query(`
        IF OBJECT_ID('dbo.Lines', 'U') IS NULL
        BEGIN
          CREATE TABLE [Lines] (
            [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            [plant_id] INT NOT NULL,
            [line_code] NVARCHAR(255) NOT NULL,
            [line_name] NVARCHAR(255) NOT NULL,
            [status] NVARCHAR(20) NOT NULL CONSTRAINT [DF_Lines_status] DEFAULT 'ACTIVE',
            [is_active] BIT NOT NULL CONSTRAINT [DF_Lines_is_active] DEFAULT 1,
            [createdAt] DATETIMEOFFSET NOT NULL CONSTRAINT [DF_Lines_createdAt] DEFAULT SYSDATETIMEOFFSET(),
            [updatedAt] DATETIMEOFFSET NOT NULL CONSTRAINT [DF_Lines_updatedAt] DEFAULT SYSDATETIMEOFFSET()
          );
        END;
      `);
      await sequelize.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Plants_plant_code' AND object_id = OBJECT_ID('dbo.Plants'))
          CREATE UNIQUE INDEX [UX_Plants_plant_code] ON [Plants] ([plant_code]);
      `);
      await sequelize.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Lines_plant_code' AND object_id = OBJECT_ID('dbo.Lines'))
          CREATE UNIQUE INDEX [UX_Lines_plant_code] ON [Lines] ([plant_id], [line_code]);
      `);
      await sequelize.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Lines_plant_name' AND object_id = OBJECT_ID('dbo.Lines'))
          CREATE UNIQUE INDEX [UX_Lines_plant_name] ON [Lines] ([plant_id], [line_name]);
      `);
      await Plant.sync();
      await Line.sync();
      await sequelize.query(`
        IF COL_LENGTH('Machines', 'plant_id') IS NULL
          ALTER TABLE [Machines] ADD [plant_id] INT NULL;
      `);
      await sequelize.query(`
        IF COL_LENGTH('Machines', 'line_id') IS NULL
          ALTER TABLE [Machines] ADD [line_id] INT NULL;
      `);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

async function ensureLinePartAssignmentSchema() {
  await ensureOrganizationSchema();
  await sequelize.query(`
    IF OBJECT_ID('dbo.LinePartAssignments', 'U') IS NOT NULL
      AND COL_LENGTH('dbo.LinePartAssignments', 'die_casting_machine') IS NULL
      ALTER TABLE [dbo].[LinePartAssignments] ADD [die_casting_machine] NVARCHAR(255) NULL;
  `);
  await LinePartAssignment.sync();
  await sequelize.query(`
    IF COL_LENGTH('dbo.LinePartAssignments', 'die_casting_machine') IS NULL
      ALTER TABLE [dbo].[LinePartAssignments] ADD [die_casting_machine] NVARCHAR(255) NULL;
  `);
}

async function ensureDefaultOrganization() {
  await ensureOrganizationSchema();

  const [plant] = await Plant.findOrCreate({
    where: { plant_code: DEFAULT_PLANT.plant_code },
    defaults: DEFAULT_PLANT,
  });

  const [line] = await Line.findOrCreate({
    where: { plant_id: plant.id, line_code: DEFAULT_LINE.line_code },
    defaults: { ...DEFAULT_LINE, plant_id: plant.id },
  });

  const orphanMachines = await Machine.findAll({
    where: {
      [Op.or]: [
        { plant_id: null },
        { line_id: null },
        { line_name: null },
        { line_name: "" },
        { line_name: "-" },
      ],
    },
    attributes: ["id", "line_name"],
  });

  for (const machine of orphanMachines) {
    const machineLineName = String(machine.line_name || "").trim();
    const targetLineName = machineLineName && machineLineName !== "-" ? machineLineName : line.line_name;
    const targetLineCode = targetLineName === line.line_name ? line.line_code : normalizeCode(targetLineName, DEFAULT_LINE.line_code);
    const [targetLine] = await Line.findOrCreate({
      where: { plant_id: plant.id, line_name: targetLineName },
      defaults: {
        plant_id: plant.id,
        line_code: targetLineCode,
        line_name: targetLineName,
        status: "ACTIVE",
        is_active: true,
      },
    });
    await Machine.update(
      {
        plant_id: plant.id,
        line_id: targetLine.id,
        line_name: targetLine.line_name,
      },
      { where: { id: machine.id } }
    );
  }

  return { plant, line };
}

async function resolveLineForPayload({ plantId, lineId, lineName }) {
  const defaults = await ensureDefaultOrganization();
  const resolvedPlantId = Number(plantId) || defaults.plant.id;
  if (lineId) {
    const line = await Line.findOne({ where: { id: Number(lineId), plant_id: resolvedPlantId } });
    if (line) return line;
  }

  const cleanLineName = String(lineName || "").trim() || DEFAULT_LINE.line_name;
  const code = normalizeCode(cleanLineName, DEFAULT_LINE.line_code);
  const [line] = await Line.findOrCreate({
    where: { plant_id: resolvedPlantId, line_name: cleanLineName },
    defaults: {
      plant_id: resolvedPlantId,
      line_code: code,
      line_name: cleanLineName,
      status: "ACTIVE",
      is_active: true,
    },
  });
  return line;
}

module.exports = {
  DEFAULT_PLANT,
  DEFAULT_LINE,
  ensureOrganizationSchema,
  ensureLinePartAssignmentSchema,
  ensureDefaultOrganization,
  resolveLineForPayload,
  normalizeCode,
};
