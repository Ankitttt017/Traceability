
require("dotenv").config();
const sequelize = require("../config/db");
const Machine = require("../models/Machine");

async function check() {
  try {
    await sequelize.authenticate();
    const all = await Machine.findAll();
    console.log('Total machines in DB:', all.length);
    all.forEach(m => {
      console.log(`- ID: ${m.id}, Name: ${m.machine_name}, Active: ${m.is_active}, Operation: ${m.operation_no}`);
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
