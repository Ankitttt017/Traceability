const path = require('path');

// Manually inject DB config since dotenv is in backend/node_modules
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '1433';
process.env.DB_USER = 'Bawal';
process.env.DB_PASS = 'Bawal@123';
process.env.DB_NAME = 'Tracebility';
process.env.DB_SYNC_ALTER = 'false';

const dbPath = path.resolve(__dirname, '../backend/config/db');
const sequelize = require(dbPath);

async function run() {
  try {
    await sequelize.authenticate();
    console.log('[DB] Connection OK');
    
    // Check if column exists
    const [results] = await sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'Machines' AND COLUMN_NAME = 'plc_slmp_device'
    `);
    
    if (results.length > 0) {
      console.log('[DB] Column plc_slmp_device exists. Dropping...');
      await sequelize.query('ALTER TABLE Machines DROP COLUMN plc_slmp_device');
      console.log('[DB] Column plc_slmp_device successfully dropped from Machines table!');
    } else {
      console.log('[DB] Column plc_slmp_device does not exist in Machines table. No action needed.');
    }
  } catch (error) {
    console.error('[DB] Migration failed:', error);
  } finally {
    process.exit();
  }
}

run();
