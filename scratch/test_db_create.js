const path = require('path');

// Manually inject DB config
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '1433';
process.env.DB_USER = 'Bawal';
process.env.DB_PASS = 'Bawal@123';
process.env.DB_NAME = 'Tracebility';

const dbPath = path.resolve(__dirname, '../backend/config/db');
const OperationLog = require(path.resolve(__dirname, '../backend/models/OperationLog'));
const sequelize = require(dbPath);

async function test() {
  const partId = 'B25E26A0153';
  const stationNo = 'OP40';
  
  try {
    await sequelize.authenticate();
    console.log('[DB] Connection OK');
    
    console.log('[DB] Attempting to create OperationLog...');
    const log = await OperationLog.create({
      part_id: partId,
      machine_id: 1, // Assuming machine 1 exists, or use a valid ID
      operation_no: stationNo,
      station_no: stationNo,
      plc_status: 'PENDING',
      result: 'OK'
    });
    console.log('[DB] Log created successfully:', log.id);

  } catch (error) {
    console.error('[DB] Create failed:', error.name, '-', error.message);
    if (error.errors) {
      error.errors.forEach(e => console.error('  - Field:', e.path, 'Message:', e.message));
    }
  } finally {
    process.exit();
  }
}

test();
