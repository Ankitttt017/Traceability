const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Part = sequelize.define("Part", {
  part_id: {
    type: DataTypes.STRING,
    unique: true,
  },
  month: DataTypes.INTEGER,
  year: DataTypes.INTEGER,
  current_operation: DataTypes.STRING,
  current_station: DataTypes.STRING,
  status: {
    type: DataTypes.STRING,
    defaultValue: "IN_PROGRESS",
  },
  is_interlocked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  interlock_reason: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  qr_format_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  last_validation_result: {
    type: DataTypes.STRING, // WAITING, PASSED, FAILED, DUPLICATE, BLOCKED
    allowNull: true,
  },
  is_rework: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
});

module.exports = Part;
