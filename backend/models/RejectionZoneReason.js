const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RejectionZoneReason = sequelize.define("RejectionZoneReason", {
  part_name: { type: DataTypes.STRING, allowNull: false, defaultValue: "DEFAULT" },
  category_id: { type: DataTypes.INTEGER, allowNull: false },
  view_id: { type: DataTypes.INTEGER, allowNull: false },
  zone_id: { type: DataTypes.INTEGER, allowNull: false },
  reason_id: { type: DataTypes.INTEGER, allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = RejectionZoneReason;
