// UPGRADE 6 COMPLETE — Alarms model for DB persistence of all alarm events
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

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
    detail: { type: DataTypes.JSON, allowNull: true, comment: "Context data: rate, lastScanTime, etc." },
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
