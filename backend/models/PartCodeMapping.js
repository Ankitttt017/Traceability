const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PartCodeMapping = sequelize.define("PartCodeMapping", {
  old_part_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  customer_qr: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  machine_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  station_no: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: "PartCodeMappings",
});

module.exports = PartCodeMapping;
