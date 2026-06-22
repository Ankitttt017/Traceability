const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RejectionZone = sequelize.define("RejectionZone", {
  view_id: { type: DataTypes.INTEGER, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  x_percent: { type: DataTypes.FLOAT, defaultValue: 0 },
  y_percent: { type: DataTypes.FLOAT, defaultValue: 0 },
  width_percent: { type: DataTypes.FLOAT, defaultValue: 10 },
  height_percent: { type: DataTypes.FLOAT, defaultValue: 10 },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = RejectionZone;
