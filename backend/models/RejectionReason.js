const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RejectionReason = sequelize.define("RejectionReason", {
  category_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = RejectionReason;
