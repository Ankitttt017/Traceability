const path = require('path');
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '1433';
process.env.DB_USER = 'Bawal';
process.env.DB_PASS = 'Bawal@123';
process.env.DB_NAME = 'Tracebility';

const dbPath = path.resolve(__dirname, '../backend/config/db');
const sequelize = require(dbPath);

async function fix() {
  try {
    await sequelize.authenticate();
    console.log('[DB] Connection OK');
    
    console.log('[DB] Attempting to drop constraint UQ_OperationLogs_cycle_token...');
    
    // MSSQL syntax to drop a constraint
    await sequelize.query(`
      IF EXISTS (SELECT * FROM sys.objects WHERE name = 'UQ_OperationLogs_cycle_token' AND type = 'UQ')
      BEGIN
        ALTER TABLE [OperationLogs] DROP CONSTRAINT [UQ_OperationLogs_cycle_token];
        PRINT 'Constraint UQ_OperationLogs_cycle_token dropped.';
      END
      ELSE
      BEGIN
        PRINT 'Constraint UQ_OperationLogs_cycle_token not found.';
      END
    `);
    
    console.log('[DB] Fix complete.');
  } catch (error) {
    console.error('[DB] Fix failed:', error.message);
  } finally {
    process.exit();
  }
}

fix();
