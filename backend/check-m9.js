require('dotenv').config();
const Machine = require('./models/Machine');
(async () => {
  try {
    const m = await Machine.findByPk(9);
    console.log(JSON.stringify({
      id: m.id,
      name: m.machine_name,
      plc_ip: m.plc_ip,
      plc_port: m.plc_port,
      plc_protocol: m.plc_protocol,
      plc_registers: m.plc_registers,
      plc_signal_map: m.plc_signal_map
    }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
