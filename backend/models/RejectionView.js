const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RejectionView = sequelize.define("RejectionView", {
  part_name: { type: DataTypes.STRING, allowNull: false, defaultValue: "DEFAULT" },
  code: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  image_url: { type: DataTypes.TEXT, allowNull: true },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = RejectionView;
