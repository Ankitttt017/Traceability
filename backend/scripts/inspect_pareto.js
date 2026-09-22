const sequelize = require('../config/db');

async function test() {
  // 1. Check raw rejection_reason and ng_reason in ProductionReports
  const rawReasons = await sequelize.query(`
    SELECT rejection_reason, COUNT(*) as cnt
    FROM ProductionReports
    WHERE (rejection_reason IS NOT NULL AND rejection_reason <> '' AND rejection_reason <> '-')
    GROUP BY rejection_reason
    ORDER BY cnt DESC
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('Top raw rejection_reason in ProductionReports:', rawReasons);

  // 2. Check total NG rows by gate / status
  const gateCounts = await sequelize.query(`
    SELECT
      SUM(CASE WHEN op100_status IN ('NG','FAIL','FAILED') THEN 1 ELSE 0 END) as op100_ng,
      SUM(CASE WHEN op110_status IN ('NG','FAIL','FAILED') THEN 1 ELSE 0 END) as op110_ng,
      SUM(CASE WHEN op120_status IN ('NG','FAIL','FAILED') THEN 1 ELSE 0 END) as op120_ng,
      SUM(CASE WHEN op130_status IN ('NG','FAIL','FAILED') THEN 1 ELSE 0 END) as op130_ng,
      SUM(CASE WHEN op140_status IN ('NG','FAIL','FAILED') THEN 1 ELSE 0 END) as op140_ng,
      SUM(CASE WHEN op150_status IN ('NG','FAIL','FAILED') OR machine_name LIKE '%Leak%' OR JSON_VALUE(leak_data, '$.result') = 'NG' THEN 1 ELSE 0 END) as op150_leak_ng,
      SUM(CASE WHEN op160_status IN ('NG','FAIL','FAILED') THEN 1 ELSE 0 END) as op160_ng,
      SUM(CASE WHEN overall_status IN ('NG','FAILED') THEN 1 ELSE 0 END) as overall_ng
    FROM ProductionReports
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('Gate NG counts:', gateCounts);

  // 3. See how getRejectionPareto query groups and counts
  const paretoRows = await sequelize.query(`
    SELECT
      CASE
        WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR pr.leak_data LIKE '%1773%' OR pr.machine_name = 'Leak-Test-01' OR pr.machine_name LIKE '%Leak%01%' THEN 'Leak-Test-01'
        WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR pr.leak_data LIKE '%1774%' OR pr.machine_name = 'Leak-Test-02' OR pr.machine_name LIKE '%Leak%02%' THEN 'Leak-Test-02'
        WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak Test-03' OR JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-03' OR pr.leak_data LIKE '%1776%' OR pr.machine_name = 'Leak Test-03' OR pr.machine_name LIKE '%Leak%03%' THEN 'Leak Test-03'
        WHEN pr.machine_name LIKE '%Leak%' OR pr.op150_status IN ('NG','FAIL','FAILED') OR pr.rejection_reason LIKE '%Leak%' OR pr.ng_reason LIKE '%Leak%' THEN 'Leak-Test-01'
        WHEN pr.op120_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Casting PDi' THEN 'OP120'
        WHEN pr.op130_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Pre Inspection' THEN 'OP130'
        WHEN pr.op140_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Auto Guaging' THEN 'OP140'
        WHEN pr.op100_status IN ('NG','FAIL','FAILED') OR pr.machine_name LIKE '%DCM%' THEN 'OP100'
        WHEN pr.op110_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Laser Marking' THEN 'OP110'
        WHEN pr.op160_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Final Inspection' THEN 'OP160'
        ELSE 'OP120'
      END as gateCode,
      pr.rejection_reason,
      COUNT(*) as cnt
    FROM ProductionReports pr
    WHERE (
      pr.overall_status IN ('NG', 'FAILED')
      OR pr.op150_status IN ('NG', 'FAIL', 'FAILED')
      OR pr.machine_name LIKE '%Leak%'
      OR JSON_VALUE(pr.leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
    )
    GROUP BY
      CASE
        WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR pr.leak_data LIKE '%1773%' OR pr.machine_name = 'Leak-Test-01' OR pr.machine_name LIKE '%Leak%01%' THEN 'Leak-Test-01'
        WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR pr.leak_data LIKE '%1774%' OR pr.machine_name = 'Leak-Test-02' OR pr.machine_name LIKE '%Leak%02%' THEN 'Leak-Test-02'
        WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak Test-03' OR JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-03' OR pr.leak_data LIKE '%1776%' OR pr.machine_name = 'Leak Test-03' OR pr.machine_name LIKE '%Leak%03%' THEN 'Leak Test-03'
        WHEN pr.machine_name LIKE '%Leak%' OR pr.op150_status IN ('NG','FAIL','FAILED') OR pr.rejection_reason LIKE '%Leak%' OR pr.ng_reason LIKE '%Leak%' THEN 'Leak-Test-01'
        WHEN pr.op120_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Casting PDi' THEN 'OP120'
        WHEN pr.op130_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Pre Inspection' THEN 'OP130'
        WHEN pr.op140_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Auto Guaging' THEN 'OP140'
        WHEN pr.op100_status IN ('NG','FAIL','FAILED') OR pr.machine_name LIKE '%DCM%' THEN 'OP100'
        WHEN pr.op110_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Laser Marking' THEN 'OP110'
        WHEN pr.op160_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Final Inspection' THEN 'OP160'
        ELSE 'OP120'
      END,
      pr.rejection_reason
    ORDER BY cnt DESC
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('Pareto grouping sample:', paretoRows.slice(0, 15));

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
