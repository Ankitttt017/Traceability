"use strict";

const INDEXES = [
  {
    table: "OperationLogs",
    name: "IX_OperationLogs_machine_id_createdAt_desc",
    columns: "[machine_id], [createdAt] DESC",
  },
  {
    table: "OperationLogs",
    name: "IX_OperationLogs_station_no_createdAt_desc",
    columns: "[station_no], [createdAt] DESC",
  },
  {
    table: "Parts",
    name: "IX_Parts_updatedAt_desc",
    columns: "[updatedAt] DESC",
  },
  {
    table: "PlcCycleReadings",
    name: "IX_PlcCycleReadings_machine_ip_shot_recorded_desc",
    columns: "[machine_name], [plc_ip], [shot_number], [recorded_at] DESC",
  },
];

function quoteLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function createIndexSql({ table, name, columns }) {
  return `
IF OBJECT_ID(N'[dbo].[${table}]', N'U') IS NOT NULL
AND NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'${quoteLiteral(name)}'
    AND object_id = OBJECT_ID(N'[dbo].[${table}]')
)
BEGIN
  CREATE INDEX [${name}] ON [dbo].[${table}] (${columns});
END
`;
}

function dropIndexSql({ table, name }) {
  return `
IF OBJECT_ID(N'[dbo].[${table}]', N'U') IS NOT NULL
AND EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'${quoteLiteral(name)}'
    AND object_id = OBJECT_ID(N'[dbo].[${table}]')
)
BEGIN
  DROP INDEX [${name}] ON [dbo].[${table}];
END
`;
}

module.exports = {
  async up(queryInterface) {
    for (const index of INDEXES) {
      await queryInterface.sequelize.query(createIndexSql(index));
    }
  },

  async down(queryInterface) {
    for (const index of [...INDEXES].reverse()) {
      await queryInterface.sequelize.query(dropIndexSql(index));
    }
  },
};
