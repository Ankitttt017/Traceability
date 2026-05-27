const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const OperationLog = sequelize.define("OperationLog", {
  part_id: DataTypes.STRING,
  operation_no: DataTypes.STRING,
  station_no: DataTypes.STRING,
  result: DataTypes.STRING,
  cycle_time: DataTypes.FLOAT,
  user_id: DataTypes.INTEGER,
  machine_id: DataTypes.INTEGER,
  plc_status: {
    type: DataTypes.ENUM("PENDING", "STARTED", "ENDED_OK", "ENDED_NG", "INTERLOCKED", "PLC_COMM_ERROR", "RESET", "RETRY", "VALIDATION_ONLY"),
    defaultValue: "PENDING",
  },
  scan_attempt_type: {
    type: DataTypes.STRING, // e.g. "INITIAL", "RE-SCAN", "REWORK"
    allowNull: true,
  },
  validation_result: {
    type: DataTypes.STRING, // WAITING, PASSED, FAILED, DUPLICATE, BLOCKED
    allowNull: true,
  },
  operation_result: {
    type: DataTypes.STRING, // IDLE, WAITING, RUNNING, PASSED, FAILED
    allowNull: true,
  },
  plc_start_time: DataTypes.DATE,
  plc_end_time: DataTypes.DATE,
  plc_start_at: DataTypes.DATE,
  plc_end_at: DataTypes.DATE,
  result_source: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  result_input: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  interlock_reason: DataTypes.STRING,
  is_bypassed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  bypass_reason: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  cycle_token: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

const Machine = require("./Machine");
OperationLog.belongsTo(Machine, { foreignKey: "machine_id" });

module.exports = OperationLog;
