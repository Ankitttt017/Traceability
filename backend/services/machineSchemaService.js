const sequelize = require("../config/db");

const FILTERED_QR_SCANNER_INDEX = "UX_Machines_qr_scanner_ip_not_blank";

function quoteIdentifier(name) {
  return `[${String(name || "").replace(/]/g, "]]")}]`;
}

async function getUniqueQrScannerIndexes(transaction) {
  const [rows] = await sequelize.query(
    `
    SELECT
      i.name AS index_name,
      CAST(i.is_unique_constraint AS bit) AS is_unique_constraint
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic
      ON ic.object_id = i.object_id
      AND ic.index_id = i.index_id
      AND ic.is_included_column = 0
    INNER JOIN sys.columns c
      ON c.object_id = ic.object_id
      AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID(N'dbo.Machines')
      AND i.is_unique = 1
    GROUP BY i.object_id, i.index_id, i.name, i.is_unique_constraint
    HAVING COUNT(*) = 1
      AND SUM(CASE WHEN c.name = 'qr_scanner_ip' THEN 1 ELSE 0 END) = 1;
    `,
    { transaction }
  );
  return rows || [];
}

async function ensureMachineQrScannerUniqueness() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const [tableRows] = await sequelize.query(
    "SELECT OBJECT_ID(N'dbo.Machines', N'U') AS table_id;"
  );
  if (!tableRows?.[0]?.table_id) return;

  const transaction = await sequelize.transaction();
  try {
    const indexes = await getUniqueQrScannerIndexes(transaction);
    for (const index of indexes) {
      const name = quoteIdentifier(index.index_name);
      if (index.is_unique_constraint) {
        await sequelize.query(`ALTER TABLE [dbo].[Machines] DROP CONSTRAINT ${name};`, { transaction });
      } else {
        await sequelize.query(`DROP INDEX ${name} ON [dbo].[Machines];`, { transaction });
      }
    }

    await sequelize.query(
      `
      UPDATE [dbo].[Machines]
      SET [qr_scanner_ip] = NULL
      WHERE [qr_scanner_ip] IS NOT NULL
        AND LTRIM(RTRIM([qr_scanner_ip])) = '';
      `,
      { transaction }
    );

    await sequelize.query(
      `
      IF NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.Machines')
          AND name = N'${FILTERED_QR_SCANNER_INDEX}'
      )
      BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX [${FILTERED_QR_SCANNER_INDEX}]
        ON [dbo].[Machines]([qr_scanner_ip])
        WHERE [qr_scanner_ip] IS NOT NULL
          AND [qr_scanner_ip] <> '';
      END;
      `,
      { transaction }
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function ensurePerformanceColumnsExist() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const [tableRows] = await sequelize.query(
    "SELECT OBJECT_ID(N'dbo.Machines', N'U') AS table_id;"
  );
  if (!tableRows?.[0]?.table_id) return;

  const columnsToAdd = [
    { name: "cycle_time", type: "INT", defaultValue: "0" },
    { name: "loading_time", type: "INT", defaultValue: "0" },
    { name: "plc_block_register", type: "INT", defaultValue: "NULL" },
    { name: "plc_running_register", type: "INT", defaultValue: "NULL" },
    { name: "plc_running_value", type: "INT", defaultValue: "2" },
    { name: "plc_end_ok_register", type: "INT", defaultValue: "NULL" },
    { name: "plc_end_ng_register", type: "INT", defaultValue: "NULL" },
    { name: "plc_bypass_register", type: "INT", defaultValue: "NULL" },
    { name: "plc_bypass_value", type: "INT", defaultValue: "1" },
    { name: "signal_hold_ms", type: "INT", defaultValue: "700" },
    { name: "reconnect_interval_ms", type: "INT", defaultValue: "3000" },
    { name: "retry_count", type: "INT", defaultValue: "3" },
    { name: "running_timeout_ms", type: "INT", defaultValue: "30000" },
    { name: "cycle_timeout_ms", type: "INT", defaultValue: "60000" },
    { name: "debounce_ms", type: "INT", defaultValue: "100" },
    { name: "heartbeat_ms", type: "INT", defaultValue: "5000" },
    { name: "bypass_enabled", type: "BIT", defaultValue: "0" },
    { name: "interlock_enable", type: "BIT", defaultValue: "1" },
    { name: "duplicate_behavior", type: "NVARCHAR(20)", defaultValue: "'BLOCK'" },
    { name: "scanner_validation_mode", type: "NVARCHAR(20)", defaultValue: "'STRICT'" }
  ];

  for (const col of columnsToAdd) {
    try {
      await sequelize.query(`
        IF NOT EXISTS (
          SELECT 1 FROM sys.columns 
          WHERE object_id = OBJECT_ID(N'dbo.Machines') 
          AND name = N'${col.name}'
        )
        BEGIN
          ALTER TABLE [dbo].[Machines] ADD [${col.name}] ${col.type};
        END
      `);

      if (col.defaultValue !== "NULL") {
        await sequelize.query(`
          IF NOT EXISTS (
            SELECT 1 FROM sys.default_constraints 
            WHERE parent_object_id = OBJECT_ID(N'dbo.Machines') 
            AND name = N'DF_Machines_${col.name}'
          )
          BEGIN
            ALTER TABLE [dbo].[Machines] ADD CONSTRAINT [DF_Machines_${col.name}] DEFAULT ${col.defaultValue} FOR [${col.name}];
            UPDATE [dbo].[Machines] SET [${col.name}] = ${col.defaultValue} WHERE [${col.name}] IS NULL;
          END
        `);
      }
    } catch (err) {
      if (err.message && !err.message.includes("already exists")) {
        console.warn(`[SchemaService] Note: Column ${col.name} check/add skipped (likely already exists).`);
      }
    }
  }
}

async function ensureTraceabilityColumnsExist() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  // 1. Handle OperationLogs
  const [logTable] = await sequelize.query("SELECT OBJECT_ID(N'dbo.OperationLogs', N'U') AS table_id;");
  if (logTable?.[0]?.table_id) {
    const logCols = [
      { name: "scan_attempt_type", type: "NVARCHAR(20)", defaultValue: "'INITIAL'" },
      { name: "validation_result", type: "NVARCHAR(20)", defaultValue: "'WAIT'" },
      { name: "operation_result", type: "NVARCHAR(20)", defaultValue: "'IDLE'" }
    ];
    for (const col of logCols) {
      try {
        await sequelize.query(`
          IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.OperationLogs') AND name = N'${col.name}')
          BEGIN
            ALTER TABLE [dbo].[OperationLogs] ADD [${col.name}] ${col.type};
          END
        `);
        if (col.defaultValue !== "NULL") {
          await sequelize.query(`
            IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.OperationLogs') AND name = N'DF_OperationLogs_${col.name}')
            BEGIN
              ALTER TABLE [dbo].[OperationLogs] ADD CONSTRAINT [DF_OperationLogs_${col.name}] DEFAULT ${col.defaultValue} FOR [${col.name}];
              UPDATE [dbo].[OperationLogs] SET [${col.name}] = ${col.defaultValue} WHERE [${col.name}] IS NULL;
            END
          `);
        }
      } catch (err) {
        if (err.message && !err.message.includes("already exists")) {
          console.warn(`[SchemaService] Note: Column ${col.name} check/add skipped in OperationLogs.`);
        }
      }
    }
  }

  // 2. Handle Parts
  const [partTable] = await sequelize.query("SELECT OBJECT_ID(N'dbo.Parts', N'U') AS table_id;");
  if (partTable?.[0]?.table_id) {
    const partCols = [
      { name: "last_validation_result", type: "NVARCHAR(20)", defaultValue: "'WAIT'" }
    ];
    for (const col of partCols) {
      try {
        await sequelize.query(`
          IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Parts') AND name = N'${col.name}')
          BEGIN
            ALTER TABLE [dbo].[Parts] ADD [${col.name}] ${col.type};
          END
        `);
        if (col.defaultValue !== "NULL") {
          await sequelize.query(`
            IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.Parts') AND name = N'DF_Parts_${col.name}')
            BEGIN
              ALTER TABLE [dbo].[Parts] ADD CONSTRAINT [DF_Parts_${col.name}] DEFAULT ${col.defaultValue} FOR [${col.name}];
              UPDATE [dbo].[Parts] SET [${col.name}] = ${col.defaultValue} WHERE [${col.name}] IS NULL;
            END
          `);
        }
      } catch (err) {
        if (err.message && !err.message.includes("already exists")) {
          console.warn(`[SchemaService] Note: Column ${col.name} check/add skipped in Parts.`);
        }
      }
    }
  }
}

module.exports = {
  ensureMachineQrScannerUniqueness,
  ensurePerformanceColumnsExist,
  ensureTraceabilityColumnsExist,
  FILTERED_QR_SCANNER_INDEX,
};
