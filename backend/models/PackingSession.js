const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PackingSession = sequelize.define("PackingSession", {
  box_number: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  capacity: {
    type: DataTypes.INTEGER,
    defaultValue: 65,
  },
  packed_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  status: {
    type: DataTypes.ENUM("OPEN", "CLOSED"),
    defaultValue: "OPEN",
  },
  label_code: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  serial_no: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  generation_source: {
    type: DataTypes.ENUM("AUTO", "MANUAL"),
    allowNull: false,
    defaultValue: "AUTO",
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
});

module.exports = PackingSession;
