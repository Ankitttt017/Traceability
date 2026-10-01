require("dotenv").config();
const sequelize = require("../config/db");

async function checkSample() {
  const [rows] = await sequelize.query(`
    SELECT TOP 10 
      part_id, overall_status, machine_name, 
      op100_status, op110_status, op120_status, op130_status, op140_status, op150_status, op160_status,
      leak_data, rejection_reason, ng_reason, createdAt, updatedAt
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE overall_status = 'IN_PROGRESS'
      AND (
        JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
        OR op150_status IN ('NG', 'FAIL', 'FAILED')
      )
    ORDER BY id DESC
  `);
  console.log("Sample in-progress rows with leak NG:");
  console.log(JSON.stringify(rows, null, 2));
}

checkSample().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
