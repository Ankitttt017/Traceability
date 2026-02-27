import axios from "axios";
import { clearAuthSession } from "../utils/authStorage";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

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
  return path.includes("/auth/login") || path.includes("/auth/verify-mfa") || path.includes("/auth/register");
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
      status === 401 || (status === 403 && (apiError.includes("UNAUTHORIZED") || apiError.includes("NO TOKEN")));

    if (authFailure && !isAuthEndpoint(requestUrl) && typeof window !== "undefined") {
      clearAuthSession();
      localStorage.setItem("auth_error_reason", "SESSION_EXPIRED");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
