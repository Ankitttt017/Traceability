const sequelize = require('./config/db');
const ProductionReport = require('./models/ProductionReport');

async function test() {
  const result = await ProductionReport.findOne({
    where: { overall_status: 'PASSED' },
    raw: true
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
test();
