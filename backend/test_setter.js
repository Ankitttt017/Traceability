const db = require('./config/db');
const ProductionReport = require('./models/ProductionReport');
(async () => {
  const t = await db.transaction();
  await ProductionReport.bulkCreate([{ part_id: 'TEST_SETTER', raw_logs: [{ test: 1 }] }], { transaction: t });
  const raw = await db.query("SELECT raw_logs FROM ProductionReports WHERE part_id = 'TEST_SETTER'", { type: db.QueryTypes.SELECT, transaction: t });
  console.log('Inserted array, DB value:', raw[0].raw_logs);
  await t.rollback();
  process.exit(0);
})()
