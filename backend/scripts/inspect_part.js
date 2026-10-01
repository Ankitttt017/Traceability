require("dotenv").config();
const sequelize = require("../config/db");

async function checkPart() {
  const [rows] = await sequelize.query(`
    SELECT pr.id, pr.part_id, pr.machine_name, pr.overall_status, pr.op100_status, pr.op120_status, pr.op130_status, pr.op140_status, pr.op150_status, pr.rejection_reason, pr.ng_reason, pr.leak_data, p.interlock_reason
    FROM [RICO_IOT].[dbo].[ProductionReports] pr
    LEFT JOIN [RICO_IOT].[dbo].[Parts] p ON p.part_id = pr.part_id
    WHERE pr.part_id LIKE '%00270926A0114%'
  `);
  console.log("ProductionReports:", rows);

  const [ops] = await sequelize.query(`
    SELECT TOP 10 operation_no, machine_name, status, result, interlock_reason, cycle_time, created_at
    FROM [RICO_IOT].[dbo].[OperationLogs]
    WHERE part_id LIKE '%00270926A0114%'
    ORDER BY id DESC
  `);
  console.log("OperationLogs:", ops);
}

checkPart().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
