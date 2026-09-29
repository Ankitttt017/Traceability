import axios from "axios";
import toast from "react-hot-toast";
import { clearAuthSession } from "../utils/authStorage";
import { getDefaultBackendOrigin, resolveBackendUrl } from "../constants/network";

/*
|--------------------------------------------------------------------------
| BASE URL CONFIG
|--------------------------------------------------------------------------
*/

const DEFAULT_SERVER_URL =
  typeof window !== "undefined" ? getDefaultBackendOrigin() : "http://localhost:9090";

const ENV_API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "").trim();
const BASE_URL = resolveBackendUrl(ENV_API_BASE_URL || `${DEFAULT_SERVER_URL}/api/v1`);

export const API_BASE_URL = BASE_URL;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

let consecutiveNetworkFailures = 0;
let isOfflineEmitted = false;
let verifyHealthTimer = null;

function emitConnectivityStatus(status, detail = {}) {
  if (typeof window === "undefined") return;

  if (status === "online") {
    isOfflineEmitted = false;
    consecutiveNetworkFailures = 0;
  } else if (status === "offline") {
    isOfflineEmitted = true;
  }

  window.dispatchEvent(
    new CustomEvent("traceability:connectivity", {
      detail: { status, ...detail },
    })
  );
}

function verifyServerUnreachable(reason) {
  if (typeof window === "undefined") return;

  // If browser is physically disconnected, emit offline immediately
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    emitConnectivityStatus("offline", {
      reason: "browser",
      message: "Browser network offline. Check internet or LAN cable.",
    });
    return;
  }

  // Double-check via lightweight health probe to avoid false alarms
  clearTimeout(verifyHealthTimer);
  verifyHealthTimer = setTimeout(async () => {
    try {
      const healthUrl = `${API_BASE_URL.replace(/\/+$/, "")}/health`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 3500);

      const res = await fetch(healthUrl, {
        method: "GET",
        cache: "no-store",
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(tid);

      if (res.ok) {
        // Health endpoint responded OK! The server is actually alive
        consecutiveNetworkFailures = 0;
        if (isOfflineEmitted) {
          emitConnectivityStatus("online");
        }
        return;
      }
    } catch (_probeErr) {
      // Probe also failed — confirmed offline
    }

    emitConnectivityStatus("offline", {
      reason,
      message:
        reason === "timeout"
          ? "Server timeout. Check API/DB connection."
          : "Unable to reach server. Please check network or backend service status.",
    });
  }, 1000);
}

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

function isAuthEndpoint(url = "") {
  const path = String(url || "");

  return (
    path.includes("/auth/login") ||
    path.includes("/auth/verify-mfa") ||
    path.includes("/auth/register")
  );
}

apiClient.interceptors.response.use(
  (response) => {
    consecutiveNetworkFailures = 0;
    if (isOfflineEmitted) {
      emitConnectivityStatus("online");
    }
    return response;
  },

  (error) => {
    // 1. Ignore user-aborted / canceled requests (e.g., page navigation, debounced queries)
    if (axios.isCancel(error) || error?.code === "ERR_CANCELED") {
      return Promise.reject(error);
    }

    const status = Number(error?.response?.status || 0);

    // 2. If status was returned by the server (4xx or 5xx), the server IS REACHABLE
    if (status > 0) {
      consecutiveNetworkFailures = 0;
      if (isOfflineEmitted) {
        emitConnectivityStatus("online");
      }
    }

    const requestUrl = String(error?.config?.url || "");

    const apiError = String(error?.response?.data?.error || "")
      .trim()
      .toUpperCase();

    const authFailure =
      status === 401 ||
      (status === 403 &&
        (apiError.includes("UNAUTHORIZED") ||
          apiError.includes("NO TOKEN")));

    const isAuthEndpointReq = isAuthEndpoint(requestUrl);
    const globalRawMessage = String(
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      ""
    );
    const globalNormalized = globalRawMessage.toLowerCase();
    const globalIsTimeout =
      error?.code === "ECONNABORTED" ||
      globalNormalized.includes("timeout") ||
      globalNormalized.includes("30000ms");
    const globalIsNetworkDown =
      error?.message === "Network Error" ||
      error?.code === "ERR_NETWORK" ||
      globalNormalized.includes("failed to fetch");

    // 3. Only count as network failure when status is 0 (no HTTP response received at all)
    if (status === 0 && (globalIsTimeout || globalIsNetworkDown)) {
      consecutiveNetworkFailures += 1;

      const isBrowserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
      // Require at least 2 consecutive failures or true browser offline before showing overlay
      if (isBrowserOffline || consecutiveNetworkFailures >= 2) {
        verifyServerUnreachable(globalIsTimeout ? "timeout" : "network");
      }
    }

    if (authFailure && !isAuthEndpointReq && typeof window !== "undefined") {
      clearAuthSession();

      localStorage.setItem("auth_error_reason", "SESSION_EXPIRED");

      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    } else if (
      !isAuthEndpointReq &&
      status !== 401 &&
      status !== 403 &&
      error?.config?.suppressGlobalError !== true
    ) {
      const rawMessage = String(
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        ""
      );
      const normalized = rawMessage.toLowerCase();
      const isTimeout =
        error?.code === "ECONNABORTED" ||
        normalized.includes("timeout") ||
        normalized.includes("30000ms");
      const isNetworkDown =
        status === 0 &&
        (error?.message === "Network Error" ||
          error?.code === "ERR_NETWORK" ||
          normalized.includes("failed to fetch"));

      let errorMessage = rawMessage || "An unexpected error occurred.";
      if (isTimeout) {
        errorMessage = "Server timeout. Check API/DB connection.";
      } else if (isNetworkDown) {
        errorMessage = "Unable to reach server. Please check network or backend service status.";
      }

      toast.error(errorMessage, {
        id: "api-error",
        duration: 3500,
      });
    }

    return Promise.reject(error);
  }
);

export default apiClient;
