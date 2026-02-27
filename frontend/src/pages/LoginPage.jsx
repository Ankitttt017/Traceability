// pages/LoginPage.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  User,
  Key,
  Lock,
  Eye,
  EyeOff,
  ShieldAlert,
  Fingerprint,
  QrCode,
} from "lucide-react";
import { authApi } from "../api/services";
import { setAuthSession } from "../utils/authStorage";
import { APP_ROUTES } from "../constants/routes";
import ThemeToggleButton from "../components/ThemeToggleButton";

const LoginPage = () => {
  const [username, setUsername] = useState(
    () => localStorage.getItem("rememberedUser") || ""
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const reason = localStorage.getItem("auth_error_reason");
    if (reason === "SESSION_EXPIRED") {
      localStorage.removeItem("auth_error_reason");
      return "Session expired. Please login again.";
    }
    return "";
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    () => Boolean(localStorage.getItem("rememberedUser"))
  );
  const [showMfa, setShowMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await authApi.login({ username, password });

      if (rememberMe) {
        localStorage.setItem("rememberedUser", username);
      } else {
        localStorage.removeItem("rememberedUser");
      }

      if (data.requiresMfa) {
        setShowMfa(true);
        setLoading(false);
      } else {
        setAuthSession({ token: data.token, user: data.user });
        navigate(APP_ROUTES.dashboard);
      }
    } catch (err) {
      setLoading(false);
      if (err.response?.status === 401) {
        setError("Invalid username or password");
      } else if (err.response?.status === 403) {
        setError("Account locked. Contact administrator");
      } else {
        setError(err.response?.data?.error || "Authentication failed");
      }
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await authApi.verifyMfa({ username, mfaCode });
      setAuthSession({ token: data.token, user: data.user });
      navigate(APP_ROUTES.dashboard);
    } catch {
      setError("Invalid verification code");
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-dark text-text-main">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-secondary/30 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(152,180,170,0.16),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(73,83,113,0.2),transparent_45%)]" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl border border-primary/30 bg-primary/10 flex items-center justify-center">
            <QrCode className="text-primary" size={20} />
          </div>
          <div>
            <p className="font-outfit text-lg font-semibold">
              Indus<span className="text-primary">Trace</span>
            </p>
            <p className="text-[10px] tracking-[0.18em] uppercase text-text-muted">
              Traceability Platform
            </p>
          </div>
        </div>
        <ThemeToggleButton showLabel />
      </header>

      <main className="relative z-10 flex min-h-[calc(100vh-84px)] items-center justify-center px-4 pb-8 sm:px-8">
        <div className="w-full max-w-md industrial-card p-8 rise-in">
          <div className="mb-6 text-center">
            <h2 className="font-outfit text-2xl font-bold text-text-main">Secure Login</h2>
            <p className="mt-1 text-sm text-text-muted">
              Access production and traceability operations
            </p>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              <ShieldAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          {!showMfa ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" size={18} />
                <input
                  type="text"
                  placeholder="Username"
                  className="block w-full rounded-md border border-border bg-bg-dark py-3 pl-10 pr-3 text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" size={18} />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  className="block w-full rounded-md border border-border bg-bg-dark py-3 pl-10 pr-10 text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <div className="flex items-center justify-between text-sm text-text-muted">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>Remember Me</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center rounded-md border border-primary/30 bg-primary px-4 py-3 text-lg font-semibold text-bg-dark hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors disabled:opacity-60"
              >
                {loading ? (
                  "Authenticating..."
                ) : (
                  <>
                    <Lock className="mr-2 h-5 w-5" />
                    Login
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-5 text-center">
              <Fingerprint size={34} className="mx-auto mb-1 text-primary" />
              <h3 className="text-lg font-semibold text-text-main">Two-Factor Authentication</h3>

              <input
                type="text"
                maxLength="6"
                placeholder="000000"
                className="w-full rounded-md border border-border bg-bg-dark py-3 text-center text-xl tracking-widest text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                value={mfaCode}
                onChange={(e) =>
                  setMfaCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
                }
                required
                disabled={loading}
              />

              <button
                type="submit"
                disabled={loading || mfaCode.length !== 6}
                className="w-full rounded-md bg-primary py-3 font-semibold text-bg-dark hover:bg-accent transition-colors disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify & Login"}
              </button>

              <button
                type="button"
                onClick={() => setShowMfa(false)}
                className="text-sm text-text-muted hover:text-primary"
              >
                Back to Login
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default LoginPage;
