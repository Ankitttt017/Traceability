const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ProductionLog = sequelize.define("ProductionLog", {
  part_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  machine_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM("OK", "NG"),
    allowNull: false,
  },
  ng_reason: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

module.exports = ProductionLog;
