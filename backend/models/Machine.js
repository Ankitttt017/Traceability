const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Machine = sequelize.define("Machine", {
  machine_number: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  station_no: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  line_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  sequence_no: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  operation_no: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  machine_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  machine_ip: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  machine_port: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  qr_scanner_ip: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
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
    type: DataTypes.ENUM("TCP_TEXT", "MODBUS_TCP"),
    defaultValue: "TCP_TEXT",
  },
  plc_unit_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 1,
  },
  plc_start_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_status_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_part_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_station_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_reset_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_start_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 1,
  },
  plc_started_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 1,
  },
  plc_end_ok_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 2,
  },
  plc_end_ng_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 3,
  },
  status: {
    type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
    defaultValue: "ACTIVE",
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
});

module.exports = Machine;
