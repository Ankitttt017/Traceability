const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Plant = require("./Plant");

const Line = sequelize.define("Line", {
  plant_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: "Plants",
      key: "id",
    },
  },
  line_code: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  line_name: {
    type: DataTypes.STRING,
    allowNull: false,
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
    { unique: true, fields: ["plant_id", "line_code"] },
    { unique: true, fields: ["plant_id", "line_name"] },
  ],
});

Line.belongsTo(Plant, { foreignKey: "plant_id" });
Plant.hasMany(Line, { foreignKey: "plant_id" });

module.exports = Line;
