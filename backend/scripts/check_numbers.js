require("dotenv").config();
const sequelize = require("../config/db");

async function checkNumbers() {
  console.log("=== COMPARING TOTAL NG VS STATION-WISE NG ===");
  const [res] = await sequelize.query(`
    SELECT 
      COUNT(*) as totalParts,
      SUM(CASE WHEN overall_status IN ('OK', 'PASSED') THEN 1 ELSE 0 END) as totalOK,
      SUM(CASE WHEN overall_status IN ('NG', 'FAILED') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED') OR op150_status IN ('NG', 'FAIL', 'FAILED') THEN 1 ELSE 0 END) as totalNG,
      SUM(CASE WHEN overall_status IN ('IN_PROGRESS', 'WIP') THEN 1 ELSE 0 END) as totalInProgress,
      SUM(CASE WHEN op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%DCM%' AND overall_status IN ('NG', 'FAILED')) THEN 1 ELSE 0 END) as op100_ng,
      SUM(CASE WHEN op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op110_ng,
      SUM(CASE WHEN op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op120_ng,
      SUM(CASE WHEN op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op130_ng,
      SUM(CASE WHEN op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op140_ng,
      SUM(CASE WHEN (
        op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
        OR (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR (rejection_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR (ng_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR (rejection_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
        OR (ng_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
      ) THEN 1 ELSE 0 END) as op150_ng,
      SUM(CASE WHEN (
        JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01'
        OR leak_data LIKE '%1773%'
        OR machine_name = 'Leak-Test-01'
        OR machine_name LIKE '%Leak%01%'
      ) AND (
        JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
        OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%'))
        OR (machine_name = 'Leak-Test-01' AND overall_status IN ('NG','FAILED'))
      ) THEN 1 ELSE 0 END) as leak01_ng,
      SUM(CASE WHEN (
        JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02'
        OR leak_data LIKE '%1774%'
        OR machine_name = 'Leak-Test-02'
        OR machine_name LIKE '%Leak%02%'
      ) AND (
        JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
        OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%'))
        OR (machine_name = 'Leak-Test-02' AND overall_status IN ('NG','FAILED'))
      ) THEN 1 ELSE 0 END) as leak02_ng,
      SUM(CASE WHEN (
        JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03'
        OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03'
        OR leak_data LIKE '%1776%'
        OR machine_name = 'Leak Test-03'
        OR machine_name LIKE '%Leak%03%'
      ) AND (
        JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
        OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%'))
        OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('NG','FAILED'))
      ) THEN 1 ELSE 0 END) as leak03_ng,
      SUM(CASE WHEN op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op160_ng
    FROM [RICO_IOT].[dbo].[ProductionReports]
  `);

  const row = res[0];
  console.log("Aggregates row:", row);

  const stationSum = (Number(row.op100_ng) || 0) +
    (Number(row.op110_ng) || 0) +
    (Number(row.op120_ng) || 0) +
    (Number(row.op130_ng) || 0) +
    (Number(row.op140_ng) || 0) +
    (Number(row.leak01_ng) || 0) +
    (Number(row.leak02_ng) || 0) +
    (Number(row.leak03_ng) || 0) +
    (Number(row.op160_ng) || 0);

  console.log("Sum of station-wise NG:", stationSum);
  console.log("Total NG:", row.totalNG);
  console.log("Difference (Total NG - Station Sum):", Number(row.totalNG) - stationSum);

  // Check how many NG parts have overall_status = 'NG' but no station status = 'NG'
  const [noStationNg] = await sequelize.query(`
    SELECT COUNT(*) as cnt
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE overall_status = 'NG'
      AND (op100_status IS NULL OR op100_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op110_status IS NULL OR op110_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op120_status IS NULL OR op120_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op130_status IS NULL OR op130_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op140_status IS NULL OR op140_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op150_status IS NULL OR op150_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op160_status IS NULL OR op160_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND NOT (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
      AND NOT (JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED'))
  `);
  console.log("NG rows where no specific station marked NG:", noStationNg[0].cnt);

  // Check what machine_name or reasons are on these rows
  const [sampleNoStationNg] = await sequelize.query(`
    SELECT TOP 10 id, part_id, machine_name, overall_status, rejection_reason, ng_reason, createdAt
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE overall_status = 'NG'
      AND (op100_status IS NULL OR op100_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op110_status IS NULL OR op110_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op120_status IS NULL OR op120_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op130_status IS NULL OR op130_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op140_status IS NULL OR op140_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op150_status IS NULL OR op150_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND (op160_status IS NULL OR op160_status NOT IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'))
      AND NOT (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
      AND NOT (JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED'))
  `);
  console.log("Sample rows without station NG:", sampleNoStationNg);
}

checkNumbers().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
