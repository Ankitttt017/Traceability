const Machine = require("./backend/models/Machine");
const sequelize = require("./backend/config/db");

async function dumpMachine() {
  try {
    await sequelize.authenticate();
    const machine = await Machine.findByPk(23);
    if (!machine) {
      console.log("Machine 23 not found");
      return;
    }
    console.log("--- MACHINE 23 CONFIG ---");
    console.log("ID:", machine.id);
    console.log("Name:", machine.machine_name);
    console.log("PLC IP:", machine.plc_ip);
    console.log("PLC Start Register:", machine.plc_start_register);
    console.log("PLC Status Register:", machine.plc_status_register);
    console.log("PLC Block Register:", machine.plc_block_register);
    console.log("PLC End OK Register:", machine.plc_end_ok_register);
    console.log("PLC End NG Register:", machine.plc_end_ng_register);
    console.log("PLC Running Register:", machine.plc_running_register);
    console.log("--------------------------");
  } catch (error) {
    console.error("Error dumping machine:", error);
  } finally {
    await sequelize.close();
  }
}

dumpMachine();
