const sequelize = require('../config/db');

async function test() {
  const start = Date.now();
  const rows = await sequelize.query(`
    SELECT TOP 100 id, part_id, customer_qr, machine_name, overall_status, rejection_reason, ng_reason
    FROM ProductionReports
    WHERE overall_status IN ('NG', 'FAILED')
    ORDER BY id DESC
  `, { type: sequelize.QueryTypes.SELECT });
  console.log(`Query took ${Date.now() - start}ms, found ${rows.length} rows`);
  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
