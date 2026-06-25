// UPGRADE 6 COMPLETE — Alarms model for DB persistence of all alarm events
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

function parseJsonText(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function stringifyJsonText(value) {
  if (value === null || value === undefined || typeof value === "string") return value;
  return JSON.stringify(value);
}

const Alarm = sequelize.define(
  "Alarm",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    type: {
      type: DataTypes.ENUM("NG_RATE", "SILENT_MACHINE", "PLC_DISCONNECT"),
      allowNull: false,
      comment: "Alarm classification",
    },
    machineId: { type: DataTypes.INTEGER, allowNull: true, comment: "Machine that triggered the alarm" },
    machineName: { type: DataTypes.STRING(200), allowNull: true },
    detail: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Context data: rate, lastScanTime, etc.",
      get() {
        return parseJsonText(this.getDataValue("detail"));
      },
      set(value) {
        this.setDataValue("detail", stringifyJsonText(value));
      },
    },
    resolvedAt: { type: DataTypes.DATE, allowNull: true, comment: "When the alarm was cleared" },
    resolvedBy: { type: DataTypes.STRING(100), allowNull: true },
  },
  {
    tableName: "alarms",
    timestamps: true,
    updatedAt: true,
    indexes: [
      { fields: ["type"] },
      { fields: ["machineId"] },
      { fields: ["resolvedAt"] },
      { fields: ["createdAt"] },
    ],
  }
);

module.exports = Alarm;
