const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('RICO_IOT', 'automation', 'Autoiot@3869', {
  host: '192.168.100.46',
  dialect: 'mssql',
  logging: false,
  dialectOptions: {
    options: {
      encrypt: false,
      trustServerCertificate: true
    }
  }
});

sequelize.query("SELECT * FROM ProductionReports WHERE customerCode = 'R437111511-54T00180826A0229' OR partId = 'R437111511-54T00180826A0229'", { type: Sequelize.QueryTypes.SELECT })
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error(e.message))
  .finally(() => process.exit(0));
