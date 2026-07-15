const LEGACY_HOSTS = (import.meta.env.VITE_LEGACY_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const CANONICAL_HOST = import.meta.env.VITE_CANONICAL_HOST || "";
const DEV_BACKEND_ORIGIN = String(import.meta.env.VITE_DEV_BACKEND_ORIGIN || "").trim();

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch (_error) {
    return "";
  }
}

export function getCanonicalOrigin() {
  if (typeof window === "undefined") return "http://localhost:9090";

  const { protocol, hostname, port, origin } = window.location;
  if (!CANONICAL_HOST || !LEGACY_HOSTS.includes(hostname)) return origin;

  return `${protocol}//${CANONICAL_HOST}${port ? `:${port}` : ""}`;
}

export function getDefaultBackendOrigin() {
  if (typeof window === "undefined") return "http://localhost:9090";

  const { protocol, hostname, port } = window.location;
  if (["3000", "5173"].includes(port)) {
    const devOrigin = normalizeOrigin(DEV_BACKEND_ORIGIN);
    if (devOrigin && ["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      return devOrigin;
    }
    return `${protocol}//${hostname}:9090`;
  }
  return getCanonicalOrigin();
}

export function resolveBackendUrl(value, fallbackPath = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const baseOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:9090";
    const url = new URL(raw, baseOrigin);
    if (typeof window !== "undefined" && ["3000", "5173"].includes(url.port)) {
      const backend = new URL(getDefaultBackendOrigin());
      url.protocol = backend.protocol;
      url.hostname = backend.hostname;
      url.port = backend.port;
    }
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return "";
  }
}

function originFromUrl(value) {
  const resolved = resolveBackendUrl(value);
  if (!resolved) return "";
  try {
    return new URL(resolved).origin;
  } catch (_error) {
    return "";
  }
}

export function redirectLegacyHost() {
  if (typeof window === "undefined") return;

  const { hostname, pathname, search, hash } = window.location;
  if (!CANONICAL_HOST || !LEGACY_HOSTS.includes(hostname)) return;

  window.location.replace(`${getCanonicalOrigin()}${pathname}${search}${hash}`);
}

const ENV_SOCKET_URL = String(import.meta.env.VITE_SOCKET_URL || "").trim();
const ENV_API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "").trim();

export const SOCKET_URL = ENV_SOCKET_URL || originFromUrl(ENV_API_BASE_URL) || getDefaultBackendOrigin();
export const SOCKET_OPTIONS = Object.freeze({
  path: "/socket.io/",
  transports: ["websocket"],
  upgrade: false,
  timeout: 8000,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
});
export const SCANNER_CONNECTION_GRACE_MS = 20000;
