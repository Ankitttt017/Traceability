const sequelize = require("./backend/config/db");

async function checkColumns() {
  try {
    await sequelize.authenticate();

    const queryInterface = sequelize.getQueryInterface();

    const machineColumns = await queryInterface.describeTable("Machines");
    console.log("Machines columns:", Object.keys(machineColumns));

    const stationColumns = await queryInterface.describeTable("StationFeatureSettings");
    console.log("StationFeatureSettings columns:", Object.keys(stationColumns));
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await sequelize.close();
  }
}

checkColumns();
