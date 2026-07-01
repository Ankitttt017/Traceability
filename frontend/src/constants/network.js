const LEGACY_HOSTS = (import.meta.env.VITE_LEGACY_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const CANONICAL_HOST = import.meta.env.VITE_CANONICAL_HOST || "";

export function getCanonicalOrigin() {
  if (typeof window === "undefined") return "http://localhost:9090";

  const { protocol, hostname, port, origin } = window.location;
  if (!CANONICAL_HOST || !LEGACY_HOSTS.includes(hostname)) return origin;

  return `${protocol}//${CANONICAL_HOST}${port ? `:${port}` : ""}`;
}

export function redirectLegacyHost() {
  if (typeof window === "undefined") return;

  const { hostname, pathname, search, hash } = window.location;
  if (!CANONICAL_HOST || !LEGACY_HOSTS.includes(hostname)) return;

  window.location.replace(`${getCanonicalOrigin()}${pathname}${search}${hash}`);
}

export const SOCKET_URL = String(import.meta.env.VITE_SOCKET_URL || "").trim() || getCanonicalOrigin();
export const SCANNER_CONNECTION_GRACE_MS = 20000;
