const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Scanner = sequelize.define("Scanner", {
  scanner_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  scanner_ip: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  scanner_port: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  scanner_mode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "TCP_CLIENT",
  },
  scanner_role: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
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
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: "MODBUS_TCP",
  },
  plc_unit_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 1,
  },
  plc_device: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: "D",
  },
  plc_frame_mode: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: "AUTO",
  },
  plc_start_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_end_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_data_type: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: "ASCII",
  },
  plc_timeout_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 8000,
  },
  plc_read_retry_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 3,
  },
  plc_read_retry_delay_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 300,
  },
  concat_separator: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  mapped_machine_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  is_simulation: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
});

module.exports = Scanner;
