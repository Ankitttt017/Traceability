// UPGRADE 5 COMPLETE — auditController: GET /api/audit (Admin only)
const AuditLog = require("../models/AuditLog");
const { Op } = require("sequelize");

/**
 * GET /api/audit
 * Returns paginated audit log. Admin role only.
 *
 * Query params:
 *   page        (default: 1)
 *   limit       (default: 50, max: 200)
 *   userId      (filter by userId)
 *   action      (filter by action enum value)
 *   dateFrom    (ISO date string, inclusive)
 *   dateTo      (ISO date string, inclusive)
 *   targetEntity (filter by entity name)
 */
async function getAuditLog(req, res) {
  try {
    // Role guard
    const user = req.user || {};
    if (user.role !== "Admin") {
      return res.status(403).json({ error: "Admin access required for audit log." });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.userId) {
      where.userId = parseInt(req.query.userId, 10);
    }
    if (req.query.action) {
      where.action = req.query.action;
    }
    if (req.query.targetEntity) {
      where.targetEntity = req.query.targetEntity;
    }
    if (req.query.dateFrom || req.query.dateTo) {
      where.createdAt = {};
      if (req.query.dateFrom) {
        where.createdAt[Op.gte] = new Date(req.query.dateFrom);
      }
      if (req.query.dateTo) {
        const to = new Date(req.query.dateTo);
        to.setHours(23, 59, 59, 999);
        where.createdAt[Op.lte] = to;
      }
    }

    const { count, rows } = await AuditLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
      raw: true,
    });

    res.json({
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    console.error("[AuditController] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getAuditLog };
