// UPGRADE 5 COMPLETE — AuditLog model for compliance logging
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AuditLog = sequelize.define(
  "AuditLog",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: true, comment: "User who performed the action (null = system)" },
    userRole: { type: DataTypes.STRING(50), allowNull: true, comment: "Role of the user at time of action" },
    action: {
      type: DataTypes.ENUM(
        "PLC_CONFIG_CHANGED",
        "MACHINE_RESET",
        "REGISTER_MAP_UPDATED",
        "USER_ROLE_CHANGED",
        "MANUAL_OVERRIDE",
        "MACHINE_CREATED",
        "MACHINE_UPDATED",
        "MACHINE_DELETED",
        "SCANNER_CREATED",
        "SCANNER_UPDATED",
        "SCANNER_DELETED",
        "QR_RULE_CHANGED",
        "SHIFT_CHANGED",
        "INTERLOCK_RESET",
        "BYPASS_GRANTED"
      ),
      allowNull: false,
    },
    targetEntity: { type: DataTypes.STRING(100), allowNull: true, comment: "e.g. Machine, Scanner, User" },
    targetId: { type: DataTypes.STRING(100), allowNull: true, comment: "ID of the affected record" },
    oldValue: { type: DataTypes.JSON, allowNull: true, comment: "Previous state (before change)" },
    newValue: { type: DataTypes.JSON, allowNull: true, comment: "New state (after change)" },
    ipAddress: { type: DataTypes.STRING(45), allowNull: true, comment: "Client IP address from request" },
    detail: { type: DataTypes.TEXT, allowNull: true, comment: "Human-readable description of the action" },
  },
  {
    tableName: "audit_logs",
    timestamps: true,
    updatedAt: false, // audit records are immutable
    indexes: [
      { fields: ["userId"] },
      { fields: ["action"] },
      { fields: ["createdAt"] },
      { fields: ["targetEntity", "targetId"] },
    ],
  }
);

module.exports = AuditLog;
