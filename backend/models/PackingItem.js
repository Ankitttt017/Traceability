const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PackingItem = sequelize.define("PackingItem", {
  session_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  part_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  slot_no: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
});

module.exports = PackingItem;
