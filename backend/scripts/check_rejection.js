require("dotenv").config();
const sequelize = require("../config/db");

async function check() {
  console.log("=== CHECKING PRODUCTION REPORTS ===");
  const [statusRows] = await sequelize.query(`
    SELECT overall_status, COUNT(*) as cnt 
    FROM [RICO_IOT].[dbo].[ProductionReports] 
    GROUP BY overall_status
  `);
  console.log("overall_status distribution:", statusRows);

  const [recentRows] = await sequelize.query(`
    SELECT TOP 10 
      part_id, 
      overall_status, 
      op100_status, op110_status, op120_status, op130_status, op140_status, op150_status, op160_status,
      machine_name, rejection_reason, ng_reason
    FROM [RICO_IOT].[dbo].[ProductionReports]
    ORDER BY id DESC
  `);
  console.log("Recent 10 rows:", recentRows);
}

check().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
