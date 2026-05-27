const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const QrFormatRule = sequelize.define("QrFormatRule", {
  format_name: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  model_code: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  regex_pattern: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  station_scope: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  sample_value: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
});

module.exports = QrFormatRule;
