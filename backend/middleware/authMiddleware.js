const jwt = require("jsonwebtoken");

function hasAnyRole(allowedRoles = []) {
  const normalized = new Set(allowedRoles.map((entry) => String(entry || "").trim()));
  return (req, res, next) => {
    const role = String(req.user?.role || "").trim();
    if (!normalized.has(role)) {
      return res.status(403).json({ error: `Require role: ${Array.from(normalized).join(" or ")}` });
    }
    next();
  };
}

exports.verifyToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(403).json({ error: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET || "secret_key", (err, decoded) => {
    if (err) return res.status(401).json({ error: "Unauthorized" });
    req.user = decoded;
    next();
  });
};

exports.isAdmin = hasAnyRole(["Admin"]);
exports.isAdminOrEngineer = hasAnyRole(["Admin", "Engineer", "Supervisor"]);
exports.isAdminOrEngineerStrict = hasAnyRole(["Admin", "Engineer"]);
