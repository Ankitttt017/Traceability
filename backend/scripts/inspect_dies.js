require("dotenv").config();
const sequelize = require("../config/db");

async function check() {
  const [rows] = await sequelize.query(`
    SELECT 
      die_name, 
      COUNT(*) as total_parts,
      SUM(CASE WHEN overall_status IN ('NG', 'FAILED') THEN 1 ELSE 0 END) as ng_count,
      SUM(CASE WHEN overall_status IN ('OK', 'PASSED') THEN 1 ELSE 0 END) as ok_count
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE die_name IS NOT NULL AND die_name != '' AND die_name != '-'
    GROUP BY die_name
    ORDER BY ng_count DESC
  `);
  console.log("Die distribution in ProductionReports:");
  console.table(rows);
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
