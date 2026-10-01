require("dotenv").config();
const sequelize = require("../config/db");

async function checkParts() {
  const parts = [
    'R437111511-54T00290926C0099',
    'R437111511-54T00290926C0081',
    'R437111511-54T00290926C0078',
    'R437111511-54T00290926C0057',
    'R437111511-54T00290926C0020'
  ];

  console.log("=== CHECKING PRODUCTION REPORTS ===");
  const [prRows] = await sequelize.query(`
    SELECT id, part_id, customer_qr, overall_status, machine_name,
           op120_status, op130_status, op150_status, op160_status,
           rejection_reason, rejection_category, ng_reason
    FROM [RICO_IOT].[dbo].[ProductionReports]
    WHERE part_id IN (:parts) OR customer_qr IN (:parts)
  `, { replacements: { parts } });
  console.log("ProductionReports:", prRows);

  console.log("=== CHECKING OPERATION LOGS ===");
  const [opLogs] = await sequelize.query(`
    SELECT TOP 20 id, part_id, machine_id, station_no, plc_status, result,
           interlock_reason, createdAt
    FROM [RICO_IOT].[dbo].[OperationLogs]
    WHERE part_id IN (:parts)
    ORDER BY id DESC
  `, { replacements: { parts } });
  console.log("OperationLogs:", opLogs);

  console.log("=== CHECKING PARTS TABLE ===");
  const [partsTable] = await sequelize.query(`
    SELECT part_id, status, current_station, interlock_reason, rejection_reason
    FROM [RICO_IOT].[dbo].[Parts]
    WHERE part_id IN (:parts)
  `, { replacements: { parts } });
  console.log("Parts table:", partsTable);
}

checkParts().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
