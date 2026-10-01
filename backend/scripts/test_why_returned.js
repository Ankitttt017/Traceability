require("dotenv").config();
const sequelize = require("../config/db");

async function checkWhy() {
  const [rows] = await sequelize.query(`
    SELECT id, part_id, overall_status, op100_status, op110_status, op120_status, op130_status, op140_status, op150_status, op160_status,
           machine_name, rejection_reason, ng_reason, JSON_VALUE(leak_data, '$.result') as leak_res
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE part_id LIKE '%00270926A0114%'
  `);
  console.log("A0114 status check:", rows);

  // Check if it matched status = 'NG' query
  const [matched] = await sequelize.query(`
    SELECT id FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE part_id LIKE '%00270926A0114%'
      AND (
        overall_status IN ('NG', 'FAILED')
        OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR (rejection_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR (ng_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
      )
  `);
  console.log("Did it match rejection status query?:", matched);
}

checkWhy().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
