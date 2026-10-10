const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

/**
 * ScannerEvent (SCANNER-FIX)
 *
 * Append-only structured log of every scanner frame / decision / connection
 * event from the TCP scanner listener. Written asynchronously in batches by
 * services/scannerEventService.js — never on the scan's critical path.
 * Retention: rows older than SCANNER_EVENT_RETENTION_DAYS (default 90) are
 * deleted once a day.
 *
 * NOTE: this model is required lazily (only when the TCP scanner server
 * starts), so a SHOP_FLOOR_IO=off instance never creates the table.
 */
const ScannerEvent = sequelize.define("ScannerEvent", {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true,
  },
  event_time: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  event_type: {
    type: DataTypes.STRING(20), // SCAN | CONNECTION | WORKFLOW
    allowNull: false,
    defaultValue: "SCAN",
  },
  stage: { type: DataTypes.STRING(80), allowNull: true },
  scanner_id: { type: DataTypes.INTEGER, allowNull: true },
  scanner_ip: { type: DataTypes.STRING(64), allowNull: true },
  scanner_role: { type: DataTypes.STRING(32), allowNull: true },
  connection_id: { type: DataTypes.STRING(64), allowNull: true },
  raw_hex: { type: DataTypes.STRING(600), allowNull: true },
  parsed_code: { type: DataTypes.STRING(255), allowNull: true },
  validation_code: { type: DataTypes.STRING(64), allowNull: true },
  flow_type: { type: DataTypes.STRING(32), allowNull: true },
  decision: { type: DataTypes.STRING(64), allowNull: true },
  active_part_source: { type: DataTypes.STRING(20), allowNull: true }, // MEMORY | PERSISTED | DB_FALLBACK
  active_part_id: { type: DataTypes.STRING(255), allowNull: true },
  mapping_id: { type: DataTypes.INTEGER, allowNull: true },
  station_no: { type: DataTypes.STRING(32), allowNull: true },
  machine_id: { type: DataTypes.INTEGER, allowNull: true },
  message: { type: DataTypes.STRING(1000), allowNull: true },
}, {
  tableName: "ScannerEvents",
  timestamps: false,
  indexes: [
    { name: "IX_ScannerEvents_EventTime", fields: ["event_time"] },
    { name: "IX_ScannerEvents_ScannerIp", fields: ["scanner_ip", "event_time"] },
    { name: "IX_ScannerEvents_ParsedCode", fields: ["parsed_code"] },
  ],
});

module.exports = ScannerEvent;
