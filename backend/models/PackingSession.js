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
});

module.exports = PackingSession;
