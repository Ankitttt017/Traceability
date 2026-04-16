const { DataTypes } = require("sequelize");
const sequelize = require("./backend/config/db");

async function addColumnIfMissing(queryInterface, tableName, columns, columnName, definition) {
  if (columns[columnName]) {
    console.log(`${tableName}.${columnName} already exists`);
    return;
  }

  await queryInterface.addColumn(tableName, columnName, definition);
  console.log(`${tableName}.${columnName} added`);
}

async function alterTable() {
  try {
    await sequelize.authenticate();
    console.log("Connected to SQL Server");

    const queryInterface = sequelize.getQueryInterface();

    const machineColumns = await queryInterface.describeTable("Machines");
    await addColumnIfMissing(queryInterface, "Machines", machineColumns, "spc_enabled", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await addColumnIfMissing(queryInterface, "Machines", machineColumns, "spc_ip", {
      type: DataTypes.STRING(255),
      allowNull: true,
    });
    await addColumnIfMissing(queryInterface, "Machines", machineColumns, "spc_port", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await addColumnIfMissing(queryInterface, "Machines", machineColumns, "spc_protocol", {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "HTTP",
    });
    await addColumnIfMissing(queryInterface, "Machines", machineColumns, "plc_handshake_enabled", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await addColumnIfMissing(queryInterface, "Machines", machineColumns, "plc_bypass_enabled", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    const stationColumns = await queryInterface.describeTable("StationFeatureSettings");
    await addColumnIfMissing(queryInterface, "StationFeatureSettings", stationColumns, "spc_enabled", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await sequelize.close();
  }
}

alterTable();
