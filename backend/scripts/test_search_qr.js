const sequelize = require('../config/db');
async function run() {
  try {
    const qr = 'R437111511-54T00030726C0274';
    const [t1] = await sequelize.query(`SELECT TOP 3 * FROM [RICO_IOT].[dbo].[ProductionReports] WHERE part_id = '${qr}' OR customer_qr = '${qr}'`);
    console.log('ProductionReports:', t1);
    const [t2] = await sequelize.query(`SELECT TOP 3 * FROM [RICO_IOT].[dbo].[FinalProductionResults] WHERE part_serial_no = '${qr}' OR customer_qr_code = '${qr}'`);
    console.log('FinalProductionResults:', t2);
    const [t3] = await sequelize.query(`SELECT TOP 3 * FROM [RICO_IOT].[dbo].[ProductionLogs] WHERE part_id = '${qr}'`);
    console.log('ProductionLogs:', t3);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
