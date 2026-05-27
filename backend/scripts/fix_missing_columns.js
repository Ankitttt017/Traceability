require("dotenv").config();
const sequelize = require("../config/db");
const { QueryTypes } = require("sequelize");

async function fixMissingColumns() {
  console.log("Checking for missing columns in OperationLogs...");
  try {
    // --- Check OperationLogs ---
    const opLogColumns = await sequelize.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'OperationLogs'",
      { type: QueryTypes.SELECT }
    );
    const opLogColumnNames = opLogColumns.map(c => c.COLUMN_NAME);

    if (!opLogColumnNames.includes("cycle_token")) {
      console.log("Adding missing column 'cycle_token' to OperationLogs...");
      await sequelize.query("ALTER TABLE OperationLogs ADD cycle_token NVARCHAR(255) NULL");
      try {
        await sequelize.query("ALTER TABLE OperationLogs ADD CONSTRAINT UQ_OperationLogs_cycle_token UNIQUE (cycle_token)");
      } catch (e) { console.warn("Unique constraint skip:", e.message); }
    }

    // --- Check Machines ---
    const machineColumns = await sequelize.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Machines'",
      { type: QueryTypes.SELECT }
    );
    const machineColumnNames = machineColumns.map(c => c.COLUMN_NAME);

    const hardeningFields = [
      ["routing_strategy", "NVARCHAR(50) DEFAULT 'FIRST_AVAILABLE'"],
      ["capabilities", "NVARCHAR(MAX) NULL"],
      ["config_version", "INT DEFAULT 1"],
      ["stagger_delay_ms", "INT DEFAULT 0"],
      ["debounce_polls", "INT DEFAULT 2"],
      ["start_hold_ms", "INT DEFAULT 500"],
      ["reset_hold_ms", "INT DEFAULT 1000"],
      ["block_hold_ms", "INT DEFAULT 500"],
      ["ack_hold_ms", "INT DEFAULT 200"],
      ["polling_interval_ms", "INT DEFAULT 100"],
      ["scan_cycle_timing", "NVARCHAR(50) DEFAULT 'STANDARD'"]
    ];

    for (const [field, type] of hardeningFields) {
      if (!machineColumnNames.includes(field)) {
        console.log(`Adding missing column '${field}' to Machines...`);
        await sequelize.query(`ALTER TABLE Machines ADD ${field} ${type}`);
      }
    }

    console.log("Schema check complete.");
  } catch (error) {
    console.error("Failed to fix missing columns:", error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

fixMissingColumns();
