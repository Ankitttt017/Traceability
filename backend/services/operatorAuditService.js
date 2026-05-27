/**
 * OperatorAuditService — Item #5
 * Immutable audit trail for all operator and supervisor actions.
 * Records: who, when, reason, before/after state.
 * Covers: manual reset, force unlock, bypass enable, supervisor override,
 *         retry cycle, mapping edits, and config changes.
 */

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// ── Sequelize Model ────────────────────────────────────────────
const AuditLog = sequelize.define("AuditLog", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  action_type: {
    type: DataTypes.ENUM(
      "MANUAL_RESET",
      "FORCE_UNLOCK",
      "BYPASS_ENABLE",
      "BYPASS_DISABLE",
      "SUPERVISOR_OVERRIDE",
      "RETRY_CYCLE",
      "MAPPING_EDIT",
      "CONFIG_CHANGE",
      "SAFE_MODE_ENTER",
      "SAFE_MODE_EXIT",
      "WATCHDOG_LOCKDOWN",
      "WATCHDOG_UNLOCK",
      "MACHINE_ISOLATE",
      "MACHINE_REJOIN",
      "PLC_CONTRACT_TEST",
      "SCANNER_AUTH_BLOCK",
      "SYSTEM"
    ),
    allowNull: false,
  },
  machine_id: { type: DataTypes.INTEGER, allowNull: true },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
  user_name: { type: DataTypes.STRING(120), allowNull: true },
  user_role: { type: DataTypes.STRING(40), allowNull: true },
  reason: { type: DataTypes.TEXT, allowNull: true },
  before_state: { type: DataTypes.JSON, allowNull: true },
  after_state: { type: DataTypes.JSON, allowNull: true },
  metadata: { type: DataTypes.JSON, allowNull: true },
  ip_address: { type: DataTypes.STRING(60), allowNull: true },
  cycle_token: { type: DataTypes.STRING(80), allowNull: true },
}, {
  tableName: "audit_logs",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false,
  indexes: [
    { fields: ["machine_id"] },
    { fields: ["action_type"] },
    { fields: ["user_id"] },
    { fields: ["created_at"] },
  ],
});

// ── Service ────────────────────────────────────────────────────
class OperatorAuditService {
  async record({
    actionType,
    machineId = null,
    userId = null,
    userName = null,
    userRole = null,
    reason = null,
    beforeState = null,
    afterState = null,
    metadata = null,
    ipAddress = null,
    cycleToken = null,
  }) {
    try {
      await AuditLog.create({
        action_type: actionType,
        machine_id: machineId,
        user_id: userId,
        user_name: userName,
        user_role: userRole,
        reason,
        before_state: beforeState,
        after_state: afterState,
        metadata,
        ip_address: ipAddress,
        cycle_token: cycleToken,
      });
    } catch (err) {
      // Audit MUST NOT block runtime operations
      console.error("[AuditLog] Failed to write audit record:", err.message);
    }
  }

  /**
   * Helper: extract user info from Express request object
   */
  extractUser(req) {
    const user = req?.user || req?.body?.user || {};
    return {
      userId: user.id || null,
      userName: user.username || user.name || user.email || null,
      userRole: user.role || null,
      ipAddress: req?.ip || req?.connection?.remoteAddress || null,
    };
  }

  async getAuditTrail({ machineId, limit = 50, actionType = null }) {
    const where = {};
    if (machineId) where.machine_id = machineId;
    if (actionType) where.action_type = actionType;

    return AuditLog.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
    });
  }

  async sync() {
    await AuditLog.sync({ alter: true });
  }
}

module.exports = {
  operatorAuditService: new OperatorAuditService(),
  AuditLog,
};
