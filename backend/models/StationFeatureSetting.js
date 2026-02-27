const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const StationFeatureSetting = sequelize.define("StationFeatureSetting", {
  station_no: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  qr_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  operation_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  rejection_bin_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
});

module.exports = StationFeatureSetting;
