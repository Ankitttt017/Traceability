const path = require('path');
const sequelize = require(path.join(process.cwd(), 'backend', 'config', 'db.js'));
(async () => {
  try {
    const [results] = await sequelize.query("SELECT TOP 1 raw_logs FROM ProductionReports WHERE station_keys LIKE '%OP130%'");
    const rawLogs = JSON.parse(results[0].raw_logs);
    console.log('Original Length:', rawLogs.length);
    console.log('Ops:', rawLogs.map(l => l.operationNo || l.operation_no).join(', '));
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
})();
