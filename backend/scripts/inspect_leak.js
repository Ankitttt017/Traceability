const sequelize = require('../config/db');

async function test() {
  const rows = await sequelize.query(`
    SELECT id, part_id, machine_name, overall_status,
           op100_status, op110_status, op120_status, op130_status, op140_status, op150_status, op160_status,
           leak_data, rejection_reason, ng_reason, rejection_category
    FROM ProductionReports
    WHERE machine_name = 'Leak-Test-01' AND overall_status = 'NG'
  `, { type: sequelize.QueryTypes.SELECT });

  console.log(`Found ${rows.length} rows with machine_name = Leak-Test-01 and overall_status = NG:`);
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2));
  }

  // Also check if there are any rows where JSON_VALUE(leak_data, '$.result') = 'NG'
  const leakNgJson = await sequelize.query(`
    SELECT TOP 10 id, part_id, machine_name, overall_status, op150_status,
           JSON_VALUE(leak_data, '$.result') as leak_result,
           JSON_VALUE(leak_data, '$.Body_Leak_Value') as body_leak_val,
           JSON_VALUE(leak_data, '$.Gall_1') as gall_1,
           JSON_VALUE(leak_data, '$.Gall_2') as gall_2,
           leak_data, rejection_reason, ng_reason
    FROM ProductionReports
    WHERE JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
       OR op150_status IN ('NG', 'FAIL', 'FAILED')
  `, { type: sequelize.QueryTypes.SELECT });
  console.log(`Found ${leakNgJson.length} rows with leak_result NG:`, leakNgJson);

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
