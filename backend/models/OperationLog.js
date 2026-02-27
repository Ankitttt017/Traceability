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
    type: DataTypes.ENUM("PENDING", "STARTED", "ENDED_OK", "ENDED_NG", "INTERLOCKED", "PLC_COMM_ERROR", "RESET"),
    defaultValue: "PENDING",
  },
  plc_start_time: DataTypes.DATE,
  plc_end_time: DataTypes.DATE,
  plc_start_at: DataTypes.DATE,
  plc_end_at: DataTypes.DATE,
  interlock_reason: DataTypes.STRING,
  is_bypassed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  bypass_reason: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

module.exports = OperationLog;
