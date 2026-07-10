const sequelize = require("../config/db");

const FILTERED_QR_SCANNER_INDEX = "IX_Machines_qr_scanner_ip_not_blank";

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
        CREATE NONCLUSTERED INDEX [${FILTERED_QR_SCANNER_INDEX}]
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
    { name: "machine_type", type: "NVARCHAR(50)", defaultValue: "'HPDC'" },
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

  const [mappingTable] = await sequelize.query("SELECT OBJECT_ID(N'dbo.RejectionZoneReasons', N'U') AS table_id;");
  if (mappingTable?.[0]?.table_id) {
    await sequelize.query(`
      IF NOT EXISTS (
        SELECT 1
        FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.RejectionZoneReasons')
          AND name = N'sub_zone_id'
      )
      BEGIN
        ALTER TABLE [dbo].[RejectionZoneReasons] ADD [sub_zone_id] INT NULL;
      END
    `);
  }
}

async function ensureScannerColumnsExist() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const [tableRows] = await sequelize.query(
    "SELECT OBJECT_ID(N'dbo.Scanners', N'U') AS table_id;"
  );
  if (!tableRows?.[0]?.table_id) return;

  try {
    await sequelize.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'dbo.Scanners') 
        AND name = N'is_simulation'
      )
      BEGIN
        ALTER TABLE [dbo].[Scanners] ADD [is_simulation] BIT;
      END
    `);

    await sequelize.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.default_constraints 
        WHERE parent_object_id = OBJECT_ID(N'dbo.Scanners') 
        AND name = N'DF_Scanners_is_simulation'
      )
      BEGIN
        ALTER TABLE [dbo].[Scanners] ADD CONSTRAINT [DF_Scanners_is_simulation] DEFAULT 0 FOR [is_simulation];
        UPDATE [dbo].[Scanners] SET [is_simulation] = 0 WHERE [is_simulation] IS NULL;
      END
    `);

    const scannerColumns = [
      { name: "scanner_mode", type: "NVARCHAR(30)", defaultValue: "'TCP_CLIENT'" },
      { name: "scanner_role", type: "NVARCHAR(30)", defaultValue: "NULL" },
      { name: "plc_ip", type: "NVARCHAR(100)", defaultValue: "NULL" },
      { name: "plc_port", type: "INT", defaultValue: "NULL" },
      { name: "plc_protocol", type: "NVARCHAR(30)", defaultValue: "'MODBUS_TCP'" },
      { name: "plc_unit_id", type: "INT", defaultValue: "1" },
      { name: "plc_device", type: "NVARCHAR(20)", defaultValue: "'D'" },
      { name: "plc_frame_mode", type: "NVARCHAR(20)", defaultValue: "'AUTO'" },
      { name: "plc_start_register", type: "INT", defaultValue: "NULL" },
      { name: "plc_end_register", type: "INT", defaultValue: "NULL" },
      { name: "plc_data_type", type: "NVARCHAR(20)", defaultValue: "'ASCII'" },
      { name: "plc_timeout_ms", type: "INT", defaultValue: "8000" },
      { name: "plc_read_retry_count", type: "INT", defaultValue: "3" },
      { name: "plc_read_retry_delay_ms", type: "INT", defaultValue: "300" },
      { name: "concat_separator", type: "NVARCHAR(20)", defaultValue: "NULL" },
    ];

    for (const col of scannerColumns) {
      await sequelize.query(`
        IF NOT EXISTS (
          SELECT 1 FROM sys.columns
          WHERE object_id = OBJECT_ID(N'dbo.Scanners')
            AND name = N'${col.name}'
        )
        BEGIN
          ALTER TABLE [dbo].[Scanners] ADD [${col.name}] ${col.type} NULL;
        END
      `);

      if (col.defaultValue !== "NULL") {
        await sequelize.query(`
          IF NOT EXISTS (
            SELECT 1 FROM sys.default_constraints
            WHERE parent_object_id = OBJECT_ID(N'dbo.Scanners')
              AND name = N'DF_Scanners_${col.name}'
          )
          BEGIN
            ALTER TABLE [dbo].[Scanners] ADD CONSTRAINT [DF_Scanners_${col.name}] DEFAULT ${col.defaultValue} FOR [${col.name}];
            UPDATE [dbo].[Scanners] SET [${col.name}] = ${col.defaultValue} WHERE [${col.name}] IS NULL;
          END
        `);
      }
    }
  } catch (err) {
    if (err.message && !err.message.includes("already exists")) {
      console.warn(`[SchemaService] Note: Column is_simulation check/add skipped in Scanners.`);
    }
  }
}

async function ensureScannerIpCanBeShared() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const [tableRows] = await sequelize.query(
    "SELECT OBJECT_ID(N'dbo.Scanners', N'U') AS table_id;"
  );
  if (!tableRows?.[0]?.table_id) return;

  const transaction = await sequelize.transaction();
  try {
    const [indexes] = await sequelize.query(
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
      WHERE i.object_id = OBJECT_ID(N'dbo.Scanners')
        AND i.is_unique = 1
      GROUP BY i.object_id, i.index_id, i.name, i.is_unique_constraint
      HAVING COUNT(*) = 1
        AND SUM(CASE WHEN c.name = 'scanner_ip' THEN 1 ELSE 0 END) = 1;
      `,
      { transaction }
    );

    for (const index of indexes || []) {
      const name = quoteIdentifier(index.index_name);
      if (index.is_unique_constraint) {
        await sequelize.query(`ALTER TABLE [dbo].[Scanners] DROP CONSTRAINT ${name};`, { transaction });
      } else {
        await sequelize.query(`DROP INDEX ${name} ON [dbo].[Scanners];`, { transaction });
      }
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function ensurePlcLinkColumnsExist() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const [machineTable] = await sequelize.query("SELECT OBJECT_ID(N'dbo.Machines', N'U') AS table_id;");
  if (machineTable?.[0]?.table_id) {
    await sequelize.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.Machines')
          AND name = N'plc_endpoint_id'
      )
      BEGIN
        ALTER TABLE [dbo].[Machines] ADD [plc_endpoint_id] INT NULL;
      END
    `);
  }

  const [rangeTable] = await sequelize.query("SELECT OBJECT_ID(N'dbo.PlcRegisterRanges', N'U') AS table_id;");
  if (rangeTable?.[0]?.table_id) {
    await sequelize.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.PlcRegisterRanges')
          AND name = N'plc_endpoint_id'
      )
      BEGIN
        ALTER TABLE [dbo].[PlcRegisterRanges] ADD [plc_endpoint_id] INT NULL;
      END
    `);
  }
}

async function ensureRoleAccessSchema() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const [tableRows] = await sequelize.query("SELECT OBJECT_ID(N'dbo.RoleAccessSettings', N'U') AS table_id;");
  if (!tableRows?.[0]?.table_id) return;

  await sequelize.query(`
    IF NOT EXISTS (
      SELECT 1
      FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.RoleAccessSettings')
        AND name = N'other_access'
    )
    BEGIN
      ALTER TABLE [dbo].[RoleAccessSettings] ADD [other_access] NVARCHAR(20) NULL;
    END
  `);

  await sequelize.query(`
    UPDATE [dbo].[RoleAccessSettings]
    SET [other_access] = 'HIDDEN'
    WHERE [other_access] IS NULL
       OR LTRIM(RTRIM([other_access])) = '';
  `);

  await sequelize.query(`
    DECLARE @constraintName sysname;
    DECLARE @sql nvarchar(max);

    DECLARE other_access_constraints CURSOR LOCAL FAST_FORWARD FOR
      SELECT cc.name
      FROM sys.check_constraints cc
      INNER JOIN sys.sql_expression_dependencies dep
        ON dep.referencing_id = cc.object_id
      INNER JOIN sys.columns col
        ON col.object_id = cc.parent_object_id
        AND col.column_id = dep.referenced_minor_id
      WHERE cc.parent_object_id = OBJECT_ID(N'dbo.RoleAccessSettings')
        AND col.name = N'other_access';

    OPEN other_access_constraints;
    FETCH NEXT FROM other_access_constraints INTO @constraintName;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      SET @sql = N'ALTER TABLE [dbo].[RoleAccessSettings] DROP CONSTRAINT ' + QUOTENAME(@constraintName);
      EXEC sp_executesql @sql;
      FETCH NEXT FROM other_access_constraints INTO @constraintName;
    END;
    CLOSE other_access_constraints;
    DEALLOCATE other_access_constraints;

    SELECT @constraintName = dc.name
    FROM sys.default_constraints dc
    INNER JOIN sys.columns col
      ON col.object_id = dc.parent_object_id
      AND col.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.RoleAccessSettings')
      AND col.name = N'other_access';

    IF @constraintName IS NOT NULL
    BEGIN
      SET @sql = N'ALTER TABLE [dbo].[RoleAccessSettings] DROP CONSTRAINT ' + QUOTENAME(@constraintName);
      EXEC sp_executesql @sql;
    END;
  `);

  await sequelize.query(`
    ALTER TABLE [dbo].[RoleAccessSettings]
    ALTER COLUMN [other_access] NVARCHAR(20) NOT NULL;
  `);

  await sequelize.query(`
    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.RoleAccessSettings')
        AND name = N'DF_RoleAccessSettings_other_access'
    )
    BEGIN
      ALTER TABLE [dbo].[RoleAccessSettings]
      ADD CONSTRAINT [DF_RoleAccessSettings_other_access]
      DEFAULT 'HIDDEN' FOR [other_access];
    END
  `);

  await sequelize.query(`
    IF NOT EXISTS (
      SELECT 1
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.RoleAccessSettings')
        AND name = N'CK_RoleAccessSettings_other_access_allowed'
    )
    BEGIN
      ALTER TABLE [dbo].[RoleAccessSettings]
      ADD CONSTRAINT [CK_RoleAccessSettings_other_access_allowed]
      CHECK ([other_access] IN ('HIDDEN', 'VIEW', 'VIEW_EDIT', 'VIEW_CONTROL'));
    END
  `);
}

async function ensureUserRoleSchema() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const [tableRows] = await sequelize.query("SELECT OBJECT_ID(N'dbo.Users', N'U') AS table_id;");
  if (!tableRows?.[0]?.table_id) return;

  await sequelize.query(`
    UPDATE [dbo].[Users]
    SET [role] = 'Operator'
    WHERE [role] IS NULL
       OR LTRIM(RTRIM([role])) = ''
       OR [role] NOT IN ('Admin', 'Engineer', 'Supervisor', 'Operator', 'Other');
  `);

  const [constraints] = await sequelize.query(`
    SELECT [name], [definition]
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.Users');
  `);

  for (const constraint of constraints || []) {
    const definition = String(constraint.definition || "");
    if (!/\brole\b/i.test(definition) && !/\[role\]/i.test(definition)) {
      continue;
    }
    await sequelize.query(`
      ALTER TABLE [dbo].[Users]
      DROP CONSTRAINT ${quoteIdentifier(constraint.name)};
    `);
  }

  await sequelize.query(`
    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.Users')
        AND name = N'DF_Users_role'
    )
    BEGIN
      ALTER TABLE [dbo].[Users]
      ADD CONSTRAINT [DF_Users_role] DEFAULT 'Operator' FOR [role];
    END
  `);

  await sequelize.query(`
    IF NOT EXISTS (
      SELECT 1
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.Users')
        AND name = N'CK_Users_role_allowed_values'
    )
    BEGIN
      ALTER TABLE [dbo].[Users]
      ADD CONSTRAINT [CK_Users_role_allowed_values]
      CHECK ([role] IN ('Admin', 'Engineer', 'Supervisor', 'Operator', 'Other'));
    END
  `);
}

async function ensureRejectionSchema() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const [logTable] = await sequelize.query("SELECT OBJECT_ID(N'dbo.OperationLogs', N'U') AS table_id;");
  if (logTable?.[0]?.table_id) {
    const columns = [
      { name: "rejection_category", type: "NVARCHAR(120)" },
      { name: "rejection_view", type: "NVARCHAR(120)" },
      { name: "rejection_zone", type: "NVARCHAR(120)" },
      { name: "rejection_reason", type: "NVARCHAR(255)" },
      { name: "rejection_remark", type: "NVARCHAR(500)" },
    ];
    for (const col of columns) {
      await sequelize.query(`
        IF NOT EXISTS (
          SELECT 1
          FROM sys.columns
          WHERE object_id = OBJECT_ID(N'dbo.OperationLogs')
            AND name = N'${col.name}'
        )
        BEGIN
          ALTER TABLE [dbo].[OperationLogs] ADD [${col.name}] ${col.type} NULL;
        END
      `);
    }
  }
}

async function ensureDatabasePerformanceIndexes() {
  const isMssql = typeof sequelize.getDialect === "function" && sequelize.getDialect() === "mssql";
  if (!isMssql) return;

  const opLogIndexes = [
    { name: "IX_OperationLogs_CreatedAt", table: "OperationLogs", columns: "[createdAt]" },
    { name: "IX_OperationLogs_PartId", table: "OperationLogs", columns: "[part_id]" },
    { name: "IX_OperationLogs_OperationNo", table: "OperationLogs", columns: "[operation_no]" },
    { name: "IX_OperationLogs_MachineId", table: "OperationLogs", columns: "[machine_id]" },
    { name: "IX_OperationLogs_PlcStatus", table: "OperationLogs", columns: "[plc_status]" }
  ];

  for (const idx of opLogIndexes) {
    await sequelize.query(`
      IF OBJECT_ID('dbo.${idx.table}', 'U') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM sys.indexes 
          WHERE object_id = OBJECT_ID('dbo.${idx.table}') 
            AND name = '${idx.name}'
        )
      BEGIN
        CREATE NONCLUSTERED INDEX [${idx.name}] ON [dbo].[${idx.table}](${idx.columns});
      END;
    `);
  }

  const plcIndexes = [
    { name: "IX_PlcCycleReadings_RecordedAt", table: "PlcCycleReadings", columns: "[recorded_at]" },
    { name: "IX_PlcCycleReadings_MachineName", table: "PlcCycleReadings", columns: "[machine_name]" },
    { name: "IX_PlcCycleReadings_PartName", table: "PlcCycleReadings", columns: "[part_name]" },
    { name: "IX_PlcCycleReadings_ShotNumber", table: "PlcCycleReadings", columns: "[shot_number]" }
  ];

  for (const idx of plcIndexes) {
    await sequelize.query(`
      IF OBJECT_ID('dbo.${idx.table}', 'U') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM sys.indexes 
          WHERE object_id = OBJECT_ID('dbo.${idx.table}') 
            AND name = '${idx.name}'
        )
      BEGIN
        CREATE NONCLUSTERED INDEX [${idx.name}] ON [dbo].[${idx.table}](${idx.columns});
      END;
    `);
  }
}

module.exports = {
  ensureMachineQrScannerUniqueness,
  ensurePerformanceColumnsExist,
  ensureTraceabilityColumnsExist,
  ensureScannerColumnsExist,
  ensureScannerIpCanBeShared,
  ensurePlcLinkColumnsExist,
  ensureRoleAccessSchema,
  ensureUserRoleSchema,
  ensureRejectionSchema,
  ensureDatabasePerformanceIndexes,
  FILTERED_QR_SCANNER_INDEX,
};
