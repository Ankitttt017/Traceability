const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PlcEndpoint = sequelize.define("PlcEndpoint", {
  endpoint_name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  plc_ip: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  plc_port: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  plc_protocol: {
    type: DataTypes.ENUM("TCP_TEXT", "MODBUS_TCP", "SLMP"),
    allowNull: false,
    defaultValue: "MODBUS_TCP",
  },
  plc_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
    allowNull: false,
    defaultValue: "ACTIVE",
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  timestamps: true,
  tableName: "plc_endpoints",
});

module.exports = PlcEndpoint;
