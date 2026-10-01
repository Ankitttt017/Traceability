require("dotenv").config();
const sequelize = require("../config/db");

async function check() {
  const [rows] = await sequelize.query(`
    SELECT * FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE part_id = 'R437111511-54T00290926C0099'
  `);
  console.log("C0099 ProductionReports row:");
  console.log("leak_data:", rows[0].leak_data);
  console.log("overall_status:", rows[0].overall_status);
  console.log("machine_name:", rows[0].machine_name);

  const [parts] = await sequelize.query(`
    SELECT * FROM [RICO_IOT].[dbo].[Parts]
    WHERE part_id = 'R437111511-54T00290926C0099'
  `);
  console.log("C0099 Parts row:");
  console.log(parts[0]);
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
