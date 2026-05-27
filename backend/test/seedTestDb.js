const sequelize = require('../config/db');
const Machine = require('../models/Machine');
const Scanner = require('../models/Scanner');

async function seed() {
  process.env.NODE_ENV = 'test';
  await sequelize.sync({ force: true });
  
  await Machine.create({
    machine_number: 'M10',
    line_name: 'LINE-1',
    machine_name: 'ST-10',
    operation_no: 'ST-10',
    sequence_no: 10,
    is_active: true,
    machine_ip: '127.0.0.1',
    plc_ip: '127.0.0.1',
    plc_port: 5021,
    plc_protocol: 'TCP_TEXT'
  });

  await Scanner.create({
    scanner_name: 'SCAN-1',
    scanner_ip: '127.0.0.1',
    mapped_machine_id: 1,
    is_active: true
  });

  console.log('✅ Test DB Seeded');
  process.exit(0);
}

seed();
