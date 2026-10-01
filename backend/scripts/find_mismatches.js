require("dotenv").config();
const sequelize = require("../config/db");

async function findMismatches() {
  console.log("=== ANALYZING EXACT MISMATCHES ===");

  // 1. Parts where more than 1 station has NG
  const [multiStationRows] = await sequelize.query(`
    SELECT part_id,
      (CASE WHEN op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%DCM%' AND overall_status IN ('NG', 'FAILED')) THEN 1 ELSE 0 END +
       CASE WHEN op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
       CASE WHEN op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
       CASE WHEN op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
       CASE WHEN op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
       CASE WHEN (
         (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name = 'Leak-Test-01' OR machine_name LIKE '%Leak%01%')
         AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%')) OR (machine_name = 'Leak-Test-01' AND overall_status IN ('NG','FAILED')))
       ) THEN 1 ELSE 0 END +
       CASE WHEN (
         (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name = 'Leak-Test-02' OR machine_name LIKE '%Leak%02%')
         AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%')) OR (machine_name = 'Leak-Test-02' AND overall_status IN ('NG','FAILED')))
       ) THEN 1 ELSE 0 END +
       CASE WHEN (
         (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03' OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03' OR leak_data LIKE '%1776%' OR machine_name = 'Leak Test-03' OR machine_name LIKE '%Leak%03%')
         AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%')) OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('NG','FAILED')))
       ) THEN 1 ELSE 0 END +
       CASE WHEN op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END
      ) as station_ng_count,
      overall_status,
      op100_status, op110_status, op120_status, op130_status, op140_status, op150_status, op160_status,
      machine_name
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE (
      (CASE WHEN op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%DCM%' AND overall_status IN ('NG', 'FAILED')) THEN 1 ELSE 0 END +
       CASE WHEN op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
       CASE WHEN op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
       CASE WHEN op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
       CASE WHEN op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
       CASE WHEN (
         (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name = 'Leak-Test-01' OR machine_name LIKE '%Leak%01%')
         AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%')) OR (machine_name = 'Leak-Test-01' AND overall_status IN ('NG','FAILED')))
       ) THEN 1 ELSE 0 END +
       CASE WHEN (
         (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name = 'Leak-Test-02' OR machine_name LIKE '%Leak%02%')
         AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%')) OR (machine_name = 'Leak-Test-02' AND overall_status IN ('NG','FAILED')))
       ) THEN 1 ELSE 0 END +
       CASE WHEN (
         (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03' OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03' OR leak_data LIKE '%1776%' OR machine_name = 'Leak Test-03' OR machine_name LIKE '%Leak%03%')
         AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%')) OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('NG','FAILED')))
       ) THEN 1 ELSE 0 END +
       CASE WHEN op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END
      ) > 1
    )
  `);
  console.log("Parts with NG at MORE THAN ONE station:", multiStationRows.length);
  if (multiStationRows.length > 0) {
    console.log("Sample multi-station NG parts:", multiStationRows.slice(0, 5));
  }

  // 2. Parts counted in totalNG but NOT in any station
  const [inTotalNotStation] = await sequelize.query(`
    SELECT COUNT(*) as cnt
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE (overall_status IN ('NG', 'FAILED') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED') OR op150_status IN ('NG', 'FAIL', 'FAILED'))
      AND (
        CASE WHEN op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%DCM%' AND overall_status IN ('NG', 'FAILED')) THEN 1 ELSE 0 END +
        CASE WHEN op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
        CASE WHEN op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
        CASE WHEN op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
        CASE WHEN op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END +
        CASE WHEN (
          (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name = 'Leak-Test-01' OR machine_name LIKE '%Leak%01%')
          AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%')) OR (machine_name = 'Leak-Test-01' AND overall_status IN ('NG','FAILED')))
        ) THEN 1 ELSE 0 END +
        CASE WHEN (
          (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name = 'Leak-Test-02' OR machine_name LIKE '%Leak%02%')
          AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%')) OR (machine_name = 'Leak-Test-02' AND overall_status IN ('NG','FAILED')))
        ) THEN 1 ELSE 0 END +
        CASE WHEN (
          (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03' OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03' OR leak_data LIKE '%1776%' OR machine_name = 'Leak Test-03' OR machine_name LIKE '%Leak%03%')
          AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%')) OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('NG','FAILED')))
        ) THEN 1 ELSE 0 END +
        CASE WHEN op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END
      ) = 0
  `);
  console.log("Parts counted in totalNG but station_count = 0:", inTotalNotStation[0].cnt);
}

findMismatches().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
