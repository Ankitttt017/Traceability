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
  plant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  line_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
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
  machine_type: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: "HPDC",
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
  },
  plc_ip: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  plc_port: {
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
  plc_range_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_protocol: {
    type: DataTypes.ENUM("TCP_TEXT", "MODBUS_TCP", "SLMP"),
    defaultValue: "TCP_TEXT",
  },
  plc_registers: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  plc_signal_map: {
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
  plc_block_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 2,
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
  plc_block_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
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
  daily_target_qty: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  cycle_time: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
  },
  loading_time: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
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
  // Hardening Fields
  routing_strategy: {
    type: DataTypes.ENUM("LEAST_BUSY", "ROUND_ROBIN", "PRIORITY_ORDER", "FIRST_AVAILABLE", "MANUAL_SELECTION"),
    defaultValue: "FIRST_AVAILABLE",
  },
  capabilities: {
    type: DataTypes.TEXT, // Store as JSON or comma-separated
    allowNull: true,
  },
  config_version: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  stagger_delay_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  debounce_polls: {
    type: DataTypes.INTEGER,
    defaultValue: 2,
  },
  start_hold_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 500,
  },
  reset_hold_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 1000,
  },
  block_hold_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 500,
  },
  ack_hold_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 200,
  },
  polling_interval_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 300,
  },
  scan_cycle_timing: {
    type: DataTypes.STRING,
    defaultValue: "STANDARD", // FAST, SLOW, NOISY
  },
  plc_running_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_running_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 1,
  },
  plc_end_ok_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_end_ng_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_bypass_register: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plc_bypass_value: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 1,
  },
  signal_hold_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 700,
  },
  reconnect_interval_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 3000,
  },
  retry_count: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
  },
  running_timeout_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 30000,
  },
  cycle_timeout_ms: {
    type: DataTypes.INTEGER,
    defaultValue: 60000,
  },
  bypass_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  interlock_enable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  duplicate_behavior: {
    type: DataTypes.ENUM("BLOCK", "WARNING", "ALLOW"),
    defaultValue: "BLOCK",
  },
  scanner_validation_mode: {
    type: DataTypes.ENUM("STRICT", "LAX"),
    defaultValue: "STRICT",
  }
});

module.exports = Machine;
