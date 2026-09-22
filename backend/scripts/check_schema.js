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

async function run() {
  try {
    const [prodWithParam] = await sequelize.query(`
      SELECT TOP 5 id, part_id, customer_qr, shot_number, metal_pressure, furnace_metal_temp, biscuit_thickness, cycle_time, intensification_time
      FROM ProductionReports
      WHERE (metal_pressure IS NOT NULL AND metal_pressure > 0)
         OR (biscuit_thickness IS NOT NULL AND biscuit_thickness > 0)
      ORDER BY id DESC
    `);
    console.log('ProductionReports with process parameters:');
    console.log(prodWithParam);

    const [plcReadings] = await sequelize.query(`
      SELECT TOP 5 id, shot_number, part_name, machine_name, metal_pressure, furnace_metal_temp, biscuit_thickness, cycle_time, intensification_time,
             biscuit_thickness_upper_limit, biscuit_thickness_lower_limit,
             metal_pressure_upper_limit, metal_pressure_lower_limit, recorded_at
      FROM PlcCycleReadings
      WHERE metal_pressure IS NOT NULL AND metal_pressure > 0
      ORDER BY id DESC
    `);
    console.log('PlcCycleReadings sample:');
    console.log(plcReadings);

    const [countProdWithParams] = await sequelize.query(`
      SELECT
        COUNT(*) as totalRows,
        SUM(CASE WHEN metal_pressure IS NOT NULL AND metal_pressure > 0 THEN 1 ELSE 0 END) as hasPressure,
        SUM(CASE WHEN biscuit_thickness IS NOT NULL AND biscuit_thickness > 0 THEN 1 ELSE 0 END) as hasBiscuit,
        SUM(CASE WHEN furnace_metal_temp IS NOT NULL AND furnace_metal_temp > 0 THEN 1 ELSE 0 END) as hasTemp
      FROM ProductionReports
    `);
    console.log('ProductionReports param count:', countProdWithParams[0]);

    const [countPlc] = await sequelize.query(`
      SELECT
        COUNT(*) as totalPlcRows,
        SUM(CASE WHEN metal_pressure IS NOT NULL AND metal_pressure > 0 THEN 1 ELSE 0 END) as hasPlcPressure,
        SUM(CASE WHEN biscuit_thickness IS NOT NULL AND biscuit_thickness > 0 THEN 1 ELSE 0 END) as hasPlcBiscuit
      FROM PlcCycleReadings
    `);
    console.log('PlcCycleReadings count:', countPlc[0]);

  } catch(e) {
    console.error('Error:', e);
  }
  process.exit(0);
}
run();
