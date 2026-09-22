const sequelize = require('../config/db');

async function test() {
  const sample = await sequelize.query(`
    SELECT TOP 10 id, part_id, machine_name, first_scan_at, final_scan_at, overall_status, op150_status,
           JSON_VALUE(leak_data, '$.matchedMachineName') as leak_mach,
           JSON_VALUE(leak_data, '$.result') as leak_result,
           JSON_VALUE(leak_data, '$.Body_Leak_Value') as body_leak,
           JSON_VALUE(leak_data, '$.Gall_1') as gall1,
           JSON_VALUE(leak_data, '$.Gall_2') as gall2,
           leak_data
    FROM ProductionReports
    WHERE (
      JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%Leak%'
      OR op150_status IN ('NG','FAIL','FAILED')
      OR machine_name LIKE '%Leak%'
    )
    ORDER BY id DESC
  `, { type: sequelize.QueryTypes.SELECT });

  console.log('Sample leak test rows:');
  for (const s of sample) {
    console.log(`ID: ${s.id} | Part: ${s.part_id} | Mach: ${s.machine_name} | LeakMach: ${s.leak_mach} | OP150: ${s.op150_status} | LeakResult: ${s.leak_result} | BodyLeak: ${s.body_leak} | Gall1: ${s.gall1} | Gall2: ${s.gall2}`);
  }

  // Check how many of those 2329 have leak_result = 'NG' vs op150_status = 'NG'
  const breakdown = await sequelize.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') THEN 1 ELSE 0 END) as json_leak_ng,
      SUM(CASE WHEN JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED') THEN 1 ELSE 0 END) as json_leak_ok,
      SUM(CASE WHEN op150_status IN ('NG','FAIL','FAILED') THEN 1 ELSE 0 END) as op150_ng,
      SUM(CASE WHEN overall_status IN ('NG','FAILED') THEN 1 ELSE 0 END) as overall_ng
    FROM ProductionReports
    WHERE (
      JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%Leak%'
      OR op150_status IN ('NG','FAIL','FAILED')
      OR machine_name LIKE '%Leak%'
    )
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('Breakdown of leak test records:', breakdown);

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
