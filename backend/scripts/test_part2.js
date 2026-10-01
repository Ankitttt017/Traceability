require("dotenv").config();
const sequelize = require("../config/db");

async function checkRow() {
  const [rows] = await sequelize.query(`
    SELECT *
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE id = 248676
  `);
  console.log(rows[0]);
}

checkRow().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
