const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PlcRegisterRange = sequelize.define("PlcRegisterRange", {
  range_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  plc_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  plc_ip: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  plc_port: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_protocol: {
    type: DataTypes.ENUM("TCP_TEXT", "MODBUS_TCP", "SLMP"),
    allowNull: false,
    defaultValue: "MODBUS_TCP",
  },
  range_start: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  range_size: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  range_end: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
    allowNull: false,
    defaultValue: "ACTIVE",
  },
  default_register_map: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_endpoint_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: "plc_endpoints",
      key: "id",
    },
  },
});

module.exports = PlcRegisterRange;
