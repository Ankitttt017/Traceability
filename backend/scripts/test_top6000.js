const sequelize = require('../config/db');

async function test() {
  const [aggregatesRes] = await sequelize.query(`
    SELECT 
      COUNT(*) as totalParts,
      SUM(CASE WHEN overall_status IN ('NG', 'FAILED') THEN 1 ELSE 0 END) as totalNG
    FROM ProductionReports
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('Aggregates:', aggregatesRes);

  const rawRows = await sequelize.query(`
    SELECT TOP 6000
      pr.[id],
      pr.[part_id],
      pr.[customer_qr],
      pr.[machine_name],
      pr.[overall_status],
      pr.[op130_status],
      pr.[rejection_reason],
      pr.[ng_reason],
      pr.[rejection_category]
    FROM ProductionReports pr
    ORDER BY pr.first_scan_at DESC
  `, { type: sequelize.QueryTypes.SELECT });

  const ngRows = rawRows.filter(r => r.overall_status === 'NG' || r.op130_status === 'NG' || r.rejection_reason);
  console.log(`Out of TOP 6000 rows, total NG is: ${ngRows.length}`);

  const op130ChipOff = rawRows.filter(r => (r.rejection_reason || '').includes('Chip') || (r.ng_reason || '').includes('Chip'));
  console.log(`Out of TOP 6000 rows, Chip-off rows: ${op130ChipOff.length}`);

  const biscuitIn6000 = rawRows.filter(r => (r.rejection_reason || '').includes('Biscuit') || (r.ng_reason || '').includes('Biscuit'));
  console.log(`Out of TOP 6000 rows, Biscuit rows: ${biscuitIn6000.length}`);

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
