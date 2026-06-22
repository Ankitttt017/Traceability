const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RejectionCategory = sequelize.define("RejectionCategory", {
  part_name: { type: DataTypes.STRING, allowNull: false, defaultValue: "DEFAULT" },
  code: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = RejectionCategory;
