require("dotenv").config();
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

async function fix() {
  console.log("Connecting to database...");
  try {
    await sequelize.authenticate();
    console.log("Connected.");

    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable("StationFeatureSettings");

    if (!tableInfo.config) {
      console.log("Adding 'config' column to StationFeatureSettings...");
      await queryInterface.addColumn("StationFeatureSettings", "config", {
        type: DataTypes.JSON,
        allowNull: true,
      });
      console.log("Column added successfully.");
    } else {
      console.log("'config' column already exists.");
    }

  } catch (error) {
    console.error("Failed to fix table:", error);
  } finally {
    await sequelize.close();
  }
}

fix();
