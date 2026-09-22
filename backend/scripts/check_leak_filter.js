const sequelize = require('../config/db');

async function test() {
  const checkPassedLeak = await sequelize.query(`
    SELECT
      COUNT(*) as total_with_leak_machine,
      SUM(CASE WHEN overall_status IN ('PASSED', 'OK') AND (op150_status IS NULL OR op150_status IN ('OK', 'PASSED')) AND JSON_VALUE(leak_data, '$.result') IN ('OK', 'PASSED') THEN 1 ELSE 0 END) as passed_parts_counted,
      SUM(CASE WHEN JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED') OR op150_status IN ('NG', 'FAIL', 'FAILED') OR overall_status IN ('NG', 'FAILED') THEN 1 ELSE 0 END) as real_ng_parts
    FROM ProductionReports pr
    WHERE pr.machine_name LIKE '%Leak%'
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('Passed parts with machine_name LIKE %Leak%:', checkPassedLeak);

  // Now check the 2329 rows that became 'Pressure Leak':
  // How many of them are ACTUALLY NG?
  const check2329 = await sequelize.query(`
    SELECT
      COUNT(*) as total_pressure_leak,
      SUM(CASE WHEN (
        JSON_VALUE(pr.leak_data, '$.result') IN ('NG','FAIL','FAILED')
        OR pr.op150_status IN ('NG','FAIL','FAILED')
        OR (pr.machine_name LIKE '%Leak%' AND pr.overall_status IN ('NG','FAILED'))
      ) THEN 1 ELSE 0 END) as true_leak_ng,
      SUM(CASE WHEN (
        pr.overall_status NOT IN ('NG','FAILED')
        AND (pr.op150_status IS NULL OR pr.op150_status NOT IN ('NG','FAIL','FAILED'))
        AND (JSON_VALUE(pr.leak_data, '$.result') IS NULL OR JSON_VALUE(pr.leak_data, '$.result') NOT IN ('NG','FAIL','FAILED'))
      ) THEN 1 ELSE 0 END) as false_positive_ok_parts
    FROM ProductionReports pr
    WHERE (
      (JSON_VALUE(pr.leak_data, '$.matchedMachineName') LIKE '%Leak%' OR pr.leak_data LIKE '%177%' OR pr.machine_name LIKE '%Leak%' OR pr.op150_status IN ('NG','FAIL','FAILED') OR pr.rejection_reason LIKE '%Leak%' OR pr.ng_reason LIKE '%Leak%')
      AND (pr.rejection_reason IS NULL OR pr.rejection_reason = '' OR pr.rejection_reason = '-')
      AND (
        pr.overall_status IN ('NG', 'FAILED')
        OR pr.op100_status IN ('NG', 'FAIL', 'FAILED')
        OR pr.op110_status IN ('NG', 'FAIL', 'FAILED')
        OR pr.op120_status IN ('NG', 'FAIL', 'FAILED')
        OR pr.op130_status IN ('NG', 'FAIL', 'FAILED')
        OR pr.op140_status IN ('NG', 'FAIL', 'FAILED')
        OR pr.op150_status IN ('NG', 'FAIL', 'FAILED')
        OR pr.op160_status IN ('NG', 'FAIL', 'FAILED')
        OR pr.machine_name LIKE '%Leak%'
        OR pr.rejection_reason LIKE '%Leak%'
        OR pr.ng_reason LIKE '%Leak%'
        OR JSON_VALUE(pr.leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
      )
    )
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('Check 2329 Pressure Leak rows:', check2329);

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
