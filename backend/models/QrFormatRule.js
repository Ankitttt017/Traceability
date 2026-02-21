const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const QrFormatRule = sequelize.define("QrFormatRule", {
  format_name: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  regex_pattern: {
    type: DataTypes.STRING,
    allowNull: false,
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
