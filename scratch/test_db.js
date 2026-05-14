const path = require('path');

// Manually inject DB config since dotenv is in backend/node_modules
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '1433';
process.env.DB_USER = 'Bawal';
process.env.DB_PASS = 'Bawal@123';
process.env.DB_NAME = 'Tracebility';
process.env.DB_SYNC_ALTER = 'false';

const dbPath = path.resolve(__dirname, '../backend/config/db');
const Part = require(path.resolve(__dirname, '../backend/models/Part'));
const OperationLog = require(path.resolve(__dirname, '../backend/models/OperationLog'));
const sequelize = require(dbPath);

async function test() {
  const partId = 'B25E26A0153';
  const stationNo = 'OP40';
  
  try {
    await sequelize.authenticate();
    console.log('[DB] Connection OK');
    
    // Check if part exists
    const part = await Part.findOne({ where: { part_id: partId } });
    console.log('[DB] Part findOne result:', part ? 'FOUND' : 'NOT FOUND');
    
    if (part) {
        console.log('[DB] Part Details:', JSON.stringify(part.toJSON(), null, 2));
    }

    // Check for existing logs at this station
    const logs = await OperationLog.findAll({ 
      where: { part_id: partId, station_no: stationNo },
      order: [['createdAt', 'DESC']]
    });
    console.log('[DB] OperationLog count:', logs.length);
    if (logs.length > 0) {
        console.log('[DB] Latest Log Status:', logs[0].plc_status);
        console.log('[DB] Latest Log Details:', JSON.stringify(logs[0].toJSON(), null, 2));
    }

  } catch (error) {
    console.error('[DB] Test failed:', error);
  } finally {
    process.exit();
  }
}

test();
