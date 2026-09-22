const sequelize = require('../config/db');

async function test() {
  const start = Date.now();
  // Find all parts where OP130 is NG and reason is Chip-off
  const rows = await sequelize.query(`
    SELECT pr.id, pr.part_id, pr.customer_qr, pr.machine_name, pr.overall_status, pr.op130_status,
           pr.rejection_reason, pr.ng_reason, pr.rejection_category, pr.shift_code
    FROM ProductionReports pr
    WHERE (
      (pr.op130_status IN ('NG','FAIL','FAILED','ENDED_NG','COMPLETED_NG') OR pr.machine_name = 'Pre Inspection' OR pr.machine_name LIKE '%Pre%')
      AND (pr.rejection_reason LIKE '%Chip%' OR pr.ng_reason LIKE '%Chip%')
    )
    ORDER BY pr.id DESC
  `, { type: sequelize.QueryTypes.SELECT });
  console.log(`Found ${rows.length} parts for OP130 + Chip-off in ${Date.now() - start}ms:`);
  for (const r of rows.slice(0, 5)) {
    console.log(`- id=${r.id}, part=${r.part_id}, qr=${r.customer_qr}, mach="${r.machine_name}", op130=${r.op130_status}, reason="${r.rejection_reason}", ngReason="${r.ng_reason}"`);
  }

  // Find all parts where reason is Biscuit Thickness
  const biscuit = await sequelize.query(`
    SELECT pr.id, pr.part_id, pr.customer_qr, pr.machine_name, pr.overall_status,
           pr.rejection_reason, pr.ng_reason, pr.rejection_category, pr.shift_code
    FROM ProductionReports pr
    WHERE (pr.rejection_reason LIKE '%Biscuit%' OR pr.ng_reason LIKE '%Biscuit%')
    ORDER BY pr.id DESC
  `, { type: sequelize.QueryTypes.SELECT });
  console.log(`Found ${biscuit.length} parts for Biscuit Thickness in ${Date.now() - start}ms:`);
  for (const r of biscuit.slice(0, 5)) {
    console.log(`- id=${r.id}, part=${r.part_id}, qr=${r.customer_qr}, reason="${r.rejection_reason}", ngReason="${r.ng_reason}"`);
  }

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
