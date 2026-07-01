const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const StationFeatureSetting = sequelize.define("StationFeatureSetting", {
  plant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  line_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  station_no: {
    type: DataTypes.STRING,
    allowNull: false,
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
  manual_result_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  plc_part_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    validate: {
      min: 1,
      max: 20,
    },
  },
  final_packing_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  config: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  indexes: [
    { unique: true, fields: ["plant_id", "line_id", "station_no"] },
  ],
});

module.exports = StationFeatureSetting;
