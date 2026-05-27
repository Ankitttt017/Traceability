const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ReworkLog = sequelize.define("ReworkLog", {
  part_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  from_station: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  to_station: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  reason: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
});

module.exports = ReworkLog;
