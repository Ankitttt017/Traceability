const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * MachineRuntimeState
 * 
 * This model persists the volatile runtime state of each PLC machine.
 * It is critical for the Industrial Hardening strategy, ensuring that
 * handshakes can be recovered after a server restart or network failure.
 */
const MachineRuntimeState = sequelize.define("MachineRuntimeState", {
  machine_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    primaryKey: true,
    references: {
      model: 'Machines',
      key: 'id'
    },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  },
  current_state: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "IDLE",
    comment: "Current FSM State (SCANNED, VALIDATED, RUNNING, etc.)"
  },
  last_transition_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  cycle_token: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: "Unique atomic ID for the current handshake cycle"
  },
  active_operation_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: "Reference to the current ProductionLog/OperationLog"
  },
  plc_snapshot: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: "JSON snapshot of PLC registers during the last transition"
  },
  recovery_state: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: "JSON metadata for resyncing state after a crash"
  },
  error_code: {
    type: DataTypes.STRING,
    allowNull: true
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_locked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: "Safety lockdown status - prevents further handshakes if true"
  },
  heartbeat_last_seen: {
    type: DataTypes.DATE,
    allowNull: true
  },
  consecutive_errors: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lockdown_reason: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'MachineRuntimeStates',
  timestamps: true,
  indexes: [
    { fields: ['current_state'] },
    { fields: ['cycle_token'] }
  ]
});

module.exports = MachineRuntimeState;
