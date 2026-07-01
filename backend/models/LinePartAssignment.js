const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const LinePartAssignment = sequelize.define("LinePartAssignment", {
  plant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  line_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  machine_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  die_casting_machine: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  part_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  die_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  display_label: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
    defaultValue: "ACTIVE",
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: "LinePartAssignments",
  indexes: [
    { fields: ["plant_id", "line_id"] },
    { fields: ["part_name"] },
    { fields: ["die_name"] },
    { fields: ["die_casting_machine"] },
  ],
});

module.exports = LinePartAssignment;
