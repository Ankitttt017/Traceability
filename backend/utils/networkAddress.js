function normalizeIp(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  let normalized = raw;
  normalized = normalized.replace(/^[a-z]+:\/\//i, "");
  normalized = normalized.split(/[/?#]/)[0];
  normalized = normalized.replace(/^::ffff:/i, "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("[") && normalized.includes("]")) {
    const endIndex = normalized.indexOf("]");
    const host = normalized.slice(1, endIndex).trim();
    return host.toLowerCase();
  }

  const hostPortMatch = normalized.match(/^([^:]+):(\d+)$/);
  if (hostPortMatch && !hostPortMatch[1].includes(":")) {
    normalized = hostPortMatch[1];
  }

  return normalized.toLowerCase();
}

function sameIp(a, b) {
  const left = normalizeIp(a);
  const right = normalizeIp(b);
  return Boolean(left) && left === right;
}

module.exports = {
  normalizeIp,
  sameIp,
};
