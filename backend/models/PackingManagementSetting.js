const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PackingManagementSetting = sequelize.define("PackingManagementSetting", {
  config_key: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    defaultValue: "DEFAULT",
  },
  box_prefix: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "BOX",
  },
  box_separator: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "-",
  },
  serial_padding: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 4,
  },
  next_serial: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  default_capacity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 65,
  },
  auto_create_next_box: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  label_prefix: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "PKG",
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
});

module.exports = PackingManagementSetting;
