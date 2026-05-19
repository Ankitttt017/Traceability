require('dotenv').config();
const Machine = require('./models/Machine');
(async () => {
  try {
    const list = await Machine.findAll();
    console.log(JSON.stringify(list.map(m => ({
      id: m.id,
      name: m.machine_name,
      machine_ip: m.machine_ip,
      plc_ip: m.plc_ip,
      plc_port: m.plc_port,
      plc_protocol: m.plc_protocol
    })), null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
