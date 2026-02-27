const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Machine = sequelize.define("Machine", {
  machine_number: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
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
  plc_range_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_protocol: {
    type: DataTypes.ENUM("TCP_TEXT", "MODBUS_TCP"),
    defaultValue: "TCP_TEXT",
  },
  plc_registers: {
    type: DataTypes.TEXT,
    allowNull: true,
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
    defaultValue: 2,
  },
  plc_end_ok_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 3,
  },
  plc_end_ng_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 4,
  },
  plc_reset_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 9,
  },
  plc_test_timeout_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 2000,
  },
  plc_test_retry_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 2,
  },
  plc_heartbeat_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_heartbeat_stale_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 5000,
  },
  status: {
    type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
    defaultValue: "ACTIVE",
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  is_running: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  running_part_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  running_station_no: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  running_started_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
});

module.exports = Machine;
