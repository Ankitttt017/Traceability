require("dotenv").config();
const sequelize = require("../config/db");

async function checkInProgressWithNg() {
  console.log("=== CHECKING IN_PROGRESS ROWS WITH NG FLAGS ===");
  const [rows] = await sequelize.query(`
    SELECT 
      COUNT(*) as total_in_progress,
      SUM(CASE WHEN op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as in_progress_op100_ng,
      SUM(CASE WHEN op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as in_progress_op110_ng,
      SUM(CASE WHEN op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as in_progress_op120_ng,
      SUM(CASE WHEN op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as in_progress_op130_ng,
      SUM(CASE WHEN op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as in_progress_op140_ng,
      SUM(CASE WHEN op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED') THEN 1 ELSE 0 END) as in_progress_op150_ng,
      SUM(CASE WHEN op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as in_progress_op160_ng
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE overall_status = 'IN_PROGRESS'
  `);
  console.log("In progress rows with NG flags:", rows[0]);

  // Check what totalNG counts when overall_status = 'IN_PROGRESS'
  const [inProgressInTotalNg] = await sequelize.query(`
    SELECT COUNT(*) as cnt
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE overall_status = 'IN_PROGRESS'
      AND (
        JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
        OR op150_status IN ('NG', 'FAIL', 'FAILED')
      )
  `);
  console.log("In progress rows counted in totalNG (because of leak_data/op150):", inProgressInTotalNg[0].cnt);
}

checkInProgressWithNg().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
