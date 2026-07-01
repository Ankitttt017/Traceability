const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Plant = sequelize.define("Plant", {
  plant_code: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  plant_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  location: {
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
  indexes: [
    { unique: true, fields: ["plant_code"] },
  ],
});

module.exports = Plant;
