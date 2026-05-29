import axios from "axios";
import toast from "react-hot-toast";
import { clearAuthSession } from "../utils/authStorage";

/*
|--------------------------------------------------------------------------
| BASE URL CONFIG
|--------------------------------------------------------------------------
| Uncomment according to environment
|--------------------------------------------------------------------------
*/

const DEFAULT_SERVER_URL =
  typeof window !== "undefined" ? window.location.origin : "http://localhost:9090";

// Production-safe default:
// 1) Use VITE_API_BASE_URL when provided.
// 2) Else call same-origin backend path (/api/v1), avoiding hardcoded LAN IP in live deploy.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || `${DEFAULT_SERVER_URL}/api/v1`;

// Live Production / LAN
// const BASE_URL = "http://172.16.9.110:4000/api/v1";

// Company Server
// const BASE_URL = "http://192.168.1.100:4000/api/v1";

// Public Domain
// const BASE_URL = "https://yourdomain.com/api/v1";

export const API_BASE_URL = BASE_URL;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

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
  (response) => response,

  (error) => {
    const status = Number(error?.response?.status || 0);

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

    if (authFailure && !isAuthEndpointReq && typeof window !== "undefined") {
      clearAuthSession();

      localStorage.setItem(
        "auth_error_reason",
        "SESSION_EXPIRED"
      );

      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    } else if (
      !isAuthEndpointReq &&
      status !== 401 &&
      status !== 403
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
        normalized.includes("15000ms");
      const isNetworkDown =
        error?.message === "Network Error" ||
        normalized.includes("failed to fetch");

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
