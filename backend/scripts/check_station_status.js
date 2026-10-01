require("dotenv").config();
const sequelize = require("../config/db");

async function check() {
  const [rows120] = await sequelize.query(`
    SELECT overall_status, COUNT(*) as cnt
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
    GROUP BY overall_status
  `);
  console.log("op120_status = NG breakdown by overall_status:", rows120);

  const [rowsLeak] = await sequelize.query(`
    SELECT overall_status, COUNT(*) as cnt
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE (JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED') OR op150_status IN ('NG', 'FAIL', 'FAILED'))
    GROUP BY overall_status
  `);
  console.log("leak NG breakdown by overall_status:", rowsLeak);

  const [rows130] = await sequelize.query(`
    SELECT overall_status, COUNT(*) as cnt
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
    GROUP BY overall_status
  `);
  console.log("op130_status = NG breakdown by overall_status:", rows130);
}

check().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
