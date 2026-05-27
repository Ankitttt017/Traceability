const path = require('path');
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '1433';
process.env.DB_USER = 'Bawal';
process.env.DB_PASS = 'Bawal@123';
process.env.DB_NAME = 'Tracebility';
const dbPath = path.resolve(__dirname, '../backend/config/db');
const sequelize = require(dbPath);

async function run() {
  try {
    await sequelize.authenticate();
    console.log('[DB] Connection OK');
    const [machineResults] = await sequelize.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Machines' AND COLUMN_NAME = 'plc_endpoint_id'`);
    if (machineResults.length === 0) {
      await sequelize.query('ALTER TABLE Machines ADD plc_endpoint_id INT NULL');
      console.log('[DB] Added plc_endpoint_id to Machines');
    }
    const [rangeResults] = await sequelize.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PlcRegisterRanges' AND COLUMN_NAME = 'plc_endpoint_id'`);
    if (rangeResults.length === 0) {
      await sequelize.query('ALTER TABLE PlcRegisterRanges ADD plc_endpoint_id INT NULL');
      console.log('[DB] Added plc_endpoint_id to PlcRegisterRanges');
    }
  } catch (error) {
    console.error('[DB] Script failed:', error);
  } finally {
    process.exit();
  }
}
run();
