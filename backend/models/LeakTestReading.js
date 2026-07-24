const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const LeakTestReading = sequelize.define("LeakTestReading", {
  part_id: { type: DataTypes.STRING, allowNull: false },
  machine_id: { type: DataTypes.INTEGER, allowNull: false },
  station_no: { type: DataTypes.STRING, allowNull: true },
  operation_log_id: { type: DataTypes.INTEGER, allowNull: true },
  payload_json: { type: DataTypes.TEXT, allowNull: false },
});

module.exports = LeakTestReading;
