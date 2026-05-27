require("dotenv").config();
const sequelize = require("../config/db");
const Machine = require("../models/Machine");
const ProductionLog = require("../models/ProductionLog");
const OperationLog = require("../models/OperationLog");
const Alarm = require("../models/Alarm");

const SEED_MACHINE_NAMES = ["ST-10", "ST-20", "ST-30"];
const SEED_MACHINE_NUMBERS = ["M10", "M20", "M30"];
const SEED_LINE_NAME = "LINE-1";
const SEED_IP = "127.0.0.1";

const CONFIRM = String(process.env.CLEANUP_SEED_CONFIRM || "").toLowerCase() === "true";

function matchesSeedSignature(machine) {
  const name = String(machine.machine_name || "").trim().toUpperCase();
  const op = String(machine.operation_no || "").trim().toUpperCase();
  const line = String(machine.line_name || "").trim().toUpperCase();
  const number = String(machine.machine_number || "").trim().toUpperCase();
  const ip = String(machine.machine_ip || "").trim();

  if (SEED_MACHINE_NAMES.includes(name) || SEED_MACHINE_NAMES.includes(op)) return true;
  if (SEED_MACHINE_NUMBERS.includes(number)) return true;
  if (line === SEED_LINE_NAME) return true;
  if (ip === SEED_IP) return true;
  return false;
}

async function run() {
  try {
    await sequelize.authenticate();

    const machines = await Machine.findAll({ raw: true });
    const seedMachines = machines.filter(matchesSeedSignature);

    if (seedMachines.length === 0) {
      console.log("No seed-like machines detected.");
      return;
    }

    console.log("Seed-like machines detected:");
    seedMachines.forEach((m) => {
      console.log(`- id=${m.id} name=${m.machine_name} op=${m.operation_no} line=${m.line_name} ip=${m.machine_ip}`);
    });

    if (!CONFIRM) {
      console.log("Dry run only. To delete, set CLEANUP_SEED_CONFIRM=true and rerun.");
      return;
    }

    const ids = seedMachines.map((m) => m.id);

    await sequelize.transaction(async (t) => {
      await ProductionLog.destroy({ where: { machine_id: ids }, transaction: t });
      await OperationLog.destroy({ where: { machine_id: ids }, transaction: t });
      await Alarm.destroy({ where: { machineId: ids }, transaction: t });
      await Machine.destroy({ where: { id: ids }, transaction: t });
    });

    console.log("Seed data cleanup completed.");
  } catch (error) {
    console.error("Seed cleanup failed:", error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

run();
