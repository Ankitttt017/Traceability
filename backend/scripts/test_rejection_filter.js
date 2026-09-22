const sequelize = require('../config/db');

async function test() {
  // Check rows matching Chip-off at OP130
  const chipOffRows = await sequelize.query(`
    SELECT id, part_id, customer_qr, machine_name, overall_status, 
           op100_status, op110_status, op120_status, op130_status, op140_status, op150_status, op160_status,
           rejection_reason, ng_reason, rejection_category
    FROM ProductionReports
    WHERE (rejection_reason LIKE '%Chip%' OR ng_reason LIKE '%Chip%')
  `, { type: sequelize.QueryTypes.SELECT });

  console.log(`Total Chip-off rows in DB: ${chipOffRows.length}`);
  
  // Group by op130_status and machine_name
  const gateBreakdown = {};
  for (const r of chipOffRows) {
    const key = `op130=${r.op130_status} | mach=${r.machine_name} | cat=${r.rejection_category} | reason=${r.rejection_reason}`;
    gateBreakdown[key] = (gateBreakdown[key] || 0) + 1;
  }
  console.log('Chip-off breakdown:', gateBreakdown);

  // Check Biscuit Thickness
  const biscuitRows = await sequelize.query(`
    SELECT id, part_id, customer_qr, machine_name, overall_status,
           rejection_reason, ng_reason, rejection_category
    FROM ProductionReports
    WHERE (rejection_reason LIKE '%Biscuit%' OR ng_reason LIKE '%Biscuit%')
  `, { type: sequelize.QueryTypes.SELECT });
  console.log(`Total Biscuit rows in DB: ${biscuitRows.length}`);
  console.log('Biscuit samples:', biscuitRows);

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
