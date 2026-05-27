function splitPatternParts(regexPattern) {
  const raw = String(regexPattern || "").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n|\|\|/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizePatternFragment(fragment) {
  if (fragment === "*") {
    return ".*";
  }
  return fragment;
}

function compileQrPattern(regexPattern) {
  const parts = splitPatternParts(regexPattern);
  if (parts.length === 0) {
    throw new Error("QR regex pattern is required");
  }

  const compiled = [];
  for (const part of parts) {
    const normalizedPart = normalizePatternFragment(part);
    try {
      compiled.push(new RegExp(normalizedPart));
    } catch (_error) {
      throw new Error(`Invalid regex pattern fragment: ${part}`);
    }
  }

  return {
    parts,
    compiled,
  };
}

function testQrPattern(regexPattern, value) {
  const { compiled } = compileQrPattern(regexPattern);
  const target = String(value || "");
  return compiled.some((regex) => regex.test(target));
}

module.exports = {
  compileQrPattern,
  testQrPattern,
};
