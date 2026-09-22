const sequelize = require('../config/db');

async function test() {
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
      pr.rejection_category,
      pr.ng_reason,
      p.interlock_reason as parts_interlock_reason,
      COUNT(*) as cnt
    FROM [RICO_IOT].[dbo].[ProductionReports] pr
    LEFT JOIN [RICO_IOT].[dbo].[Parts] p ON p.part_id = pr.part_id
    WHERE (
      pr.overall_status IN ('NG', 'FAILED')
      OR pr.op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR (pr.machine_name LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
      OR (pr.rejection_reason LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
      OR (pr.ng_reason LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
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
      pr.rejection_reason, pr.rejection_category, pr.ng_reason, p.interlock_reason
  `, { type: sequelize.QueryTypes.SELECT });

  const reasonMap = {};
  for (const r of paretoRows) {
    const cnt = Number(r.cnt || 0);
    const gate = r.gateCode;
    let rawReason = r.rejection_reason;
    if (!rawReason) {
      if (gate.includes('Leak') || gate === 'OP150') rawReason = 'Pressure Leak';
      else rawReason = `${gate} Defect NG`;
    }
    reasonMap[rawReason] = (reasonMap[rawReason] || 0) + cnt;
  }

  const sorted = Object.entries(reasonMap).sort((a, b) => b[1] - a[1]);
  console.log('CORRECTED Pareto Rejection Distribution (without 827 OK parts):');
  sorted.slice(0, 10).forEach(([reason, cnt], i) => {
    console.log(`#${i + 1}: ${reason} -> ${cnt} pcs`);
  });

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
