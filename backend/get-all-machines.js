require('dotenv').config();
const Machine = require('./models/Machine');
(async () => {
  try {
    const machines = await Machine.findAll();
    console.log(machines.map(m => ({
      id: m.id,
      name: m.machine_name,
      ip: m.plc_ip,
      port: m.plc_port,
      protocol: m.plc_protocol,
      plc_registers: m.plc_registers ? true : false,
    })));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
