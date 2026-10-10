const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * LaserWorkflowState (SCANNER-FIX)
 *
 * Persisted copy of the in-memory "DPM scanned, waiting for Customer QR"
 * state per machine/station (services/laserMarkingWorkflowService.js) so a
 * backend restart does not lose the waiting part. One row per workflow key
 * ("<machineId>:<stationNo>").
 *
 * A separate table is used instead of MachineRuntimeStates because that table
 * is keyed by machine_id and owned by the PLC handshake FSM
 * (plcHandshakeEngine) — sharing it would let the two state machines
 * overwrite each other.
 *
 * Required lazily (only when the TCP scanner server starts).
 */
const LaserWorkflowState = sequelize.define("LaserWorkflowState", {
  workflow_key: {
    type: DataTypes.STRING(100),
    primaryKey: true,
    allowNull: false,
  },
  machine_id: { type: DataTypes.INTEGER, allowNull: true },
  station_no: { type: DataTypes.STRING(32), allowNull: true },
  active_part_id: { type: DataTypes.STRING(255), allowNull: true },
  waiting_for_customer_qr: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  waiting_since: { type: DataTypes.DATE, allowNull: true },
  status: { type: DataTypes.STRING(40), allowNull: true },
  last_error: { type: DataTypes.STRING(255), allowNull: true },
}, {
  tableName: "LaserWorkflowStates",
  timestamps: true,
});

module.exports = LaserWorkflowState;
