const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Scanner = sequelize.define("Scanner", {
  scanner_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  scanner_ip: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  scanner_port: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  mapped_machine_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
});

module.exports = Scanner;
