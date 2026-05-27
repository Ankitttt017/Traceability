const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Shift = sequelize.define("Shift", {
  shift_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  shift_code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  start_time: {
    type: DataTypes.TIME,
    allowNull: false,
  },
  end_time: {
    type: DataTypes.TIME,
    allowNull: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
});

module.exports = Shift;
