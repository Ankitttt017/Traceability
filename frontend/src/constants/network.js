const LEGACY_HOSTS = ["192.168.100.137"];
const CANONICAL_HOST = import.meta.env.VITE_CANONICAL_HOST || "192.168.100.137";

export function getCanonicalOrigin() {
  if (typeof window === "undefined") return "http://localhost:9090";

  const { protocol, hostname, port, origin } = window.location;
  if (!LEGACY_HOSTS.includes(hostname)) return origin;

  return `${protocol}//${CANONICAL_HOST}${port ? `:${port}` : ""}`;
}

export function redirectLegacyHost() {
  if (typeof window === "undefined") return;

  const { hostname, pathname, search, hash } = window.location;
  if (!LEGACY_HOSTS.includes(hostname)) return;

  window.location.replace(`${getCanonicalOrigin()}${pathname}${search}${hash}`);
}

export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || getCanonicalOrigin();
export const SCANNER_CONNECTION_GRACE_MS = 20000;
