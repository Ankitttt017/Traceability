require("dotenv").config();
const sequelize = require("../config/db");

async function testEnrichment() {
  const [rows] = await sequelize.query(`
    SELECT TOP 10 
      pr.id, pr.part_id, pr.customer_qr, pr.machine_name, pr.overall_status, 
      pr.rejection_category, pr.rejection_reason, pr.ng_reason, pr.leak_data,
      p.interlock_reason as parts_interlock_reason
    FROM [RICO_IOT].[dbo].[ProductionReports] pr
    LEFT JOIN [RICO_IOT].[dbo].[Parts] p ON p.part_id = pr.part_id
    WHERE pr.part_id IN ('R437111511-54T00290926C0099', 'R437111511-54T00290926C0081', 'R437111511-54T00290926C0078', 'R437111511-54T00290926C0057', 'R437111511-54T00290926C0020')
  `);
  
  rows.forEach(r => {
    let leakParsed = null;
    try { leakParsed = JSON.parse(r.leak_data || '{}'); } catch(e){}
    const isLeakNg = leakParsed && (leakParsed.result === 'NG' || leakParsed.Raw_Result === 'NG');
    console.log('Part:', r.part_id);
    console.log(' - machine_name:', r.machine_name);
    console.log(' - overall_status:', r.overall_status);
    console.log(' - isLeakNg:', Boolean(isLeakNg), 'Leak Machine:', leakParsed?.matchedMachineName || leakParsed?.machineName, 'BodyLeak:', leakParsed?.bodyLeakValue);
  });
}

testEnrichment().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
