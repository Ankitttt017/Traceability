// UPGRADE 5 COMPLETE — auditMiddleware: auto-log PUT/DELETE to AuditLog
const AuditLog = require("../models/AuditLog");

/**
 * Express middleware that automatically writes an audit record for any
 * PUT or DELETE request. Attach after authenticate middleware in routes.
 *
 * Captured fields: user (from JWT), IP, route params, before/after body.
 *
 * Action mapping (override via req.auditAction if needed):
 *   PUT  → resolved from route or defaults to MACHINE_UPDATED
 *   DELETE → resolved from route or defaults to MACHINE_DELETED
 */
function auditMiddleware(req, res, next) {
  const allowedMethods = ["PUT", "DELETE", "PATCH"];
  if (!allowedMethods.includes(req.method)) {
    return next();
  }

  // Capture original json() so we can intercept the response body
  const originalJson = res.json.bind(res);
  const reqBody = req.body ? { ...req.body } : {};
  // Strip sensitive fields from audit body
  delete reqBody.password;
  delete reqBody.token;

  res.json = function (data) {
    // Determine action from the request or a manually set override
    const action = req.auditAction || _resolveAction(req);

    // Fire-and-forget — don't block the response
    _writeAuditLog({ req, action, reqBody, responseData: data }).catch((err) =>
      console.error("[AuditMiddleware] Failed to write audit log:", err.message)
    );

    return originalJson(data);
  };

  next();
}

function _resolveAction(req) {
  const url = req.originalUrl.toLowerCase();
  if (url.includes("plc") || url.includes("register")) {
    return req.method === "DELETE" ? "MACHINE_DELETED" : "PLC_CONFIG_CHANGED";
  }
  if (url.includes("machine")) {
    return req.method === "DELETE" ? "MACHINE_DELETED" : "MACHINE_UPDATED";
  }
  if (url.includes("scanner")) {
    return req.method === "DELETE" ? "SCANNER_DELETED" : "SCANNER_UPDATED";
  }
  if (url.includes("user") && url.includes("role")) {
    return "USER_ROLE_CHANGED";
  }
  if (url.includes("shift")) {
    return "SHIFT_CHANGED";
  }
  if (url.includes("qr") || url.includes("format")) {
    return "QR_RULE_CHANGED";
  }
  return req.method === "DELETE" ? "MACHINE_DELETED" : "MACHINE_UPDATED";
}

async function _writeAuditLog({ req, action, reqBody, responseData }) {
  const user = req.user || {};
  const params = req.params || {};
  const targetId = params.id || params.machineId || params.scannerId || null;

  // Best-effort entity resolution from route
  const url = req.originalUrl.toLowerCase();
  let targetEntity = "Unknown";
  if (url.includes("machine")) targetEntity = "Machine";
  else if (url.includes("scanner")) targetEntity = "Scanner";
  else if (url.includes("user")) targetEntity = "User";
  else if (url.includes("shift")) targetEntity = "Shift";
  else if (url.includes("qr")) targetEntity = "QrFormatRule";
  else if (url.includes("plc")) targetEntity = "PlcConfig";

  await AuditLog.create({
    userId: user.id || user.userId || null,
    userRole: user.role || null,
    action,
    targetEntity,
    targetId: targetId ? String(targetId) : null,
    oldValue: null, // pre-change snapshot would require a DB fetch before the op
    newValue: reqBody,
    ipAddress: req.ip || req.connection?.remoteAddress || null,
    detail: `${req.method} ${req.originalUrl}`,
  });
}

module.exports = { auditMiddleware };
