// pages/LoginPage.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Lock, 
  User, 
  ShieldAlert, 
  Eye, 
  EyeOff,
  Fingerprint,
  AlertCircle,
  CheckCircle,
  Factory,
  QrCode,
  Wifi,
  WifiOff
} from "lucide-react";
import { authApi } from "../api/services";
import { setAuthSession } from "../utils/authStorage";
import { APP_ROUTES } from "../constants/routes";

const LoginPage = () => {
  const [username, setUsername] = useState(() => localStorage.getItem("rememberedUser") || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => Boolean(localStorage.getItem("rememberedUser")));
  const [systemStatus, setSystemStatus] = useState(() => (Math.random() > 0.1 ? "online" : "degraded"));
  const [showMfa, setShowMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await authApi.login({
        username,
        password,
      });

      // Handle remember me
      if (rememberMe) {
        localStorage.setItem("rememberedUser", username);
      } else {
        localStorage.removeItem("rememberedUser");
      }

      // Check if MFA is required
      if (data.requiresMfa) {
        setShowMfa(true);
        setLoading(false);
      } else {
        setAuthSession({ token: data.token, user: data.user });
        // Successful login without MFA
        setLoading(false);
        navigate(APP_ROUTES.dashboard);
      }
    } catch (err) {
      setLoading(false);
      if (err.response?.status === 401) {
        setError("Invalid username or secure key");
      } else if (err.response?.status === 403) {
        setError("Account locked. Contact administrator");
      } else if (err.code === "ECONNREFUSED" || err.code === "ERR_NETWORK") {
        setError("Unable to connect to server");
        setSystemStatus("offline");
      } else {
        setError(err.response?.data?.error || "Authentication failed");
      }
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await authApi.verifyMfa({
        username,
        mfaCode
      });
      setAuthSession({ token: data.token, user: data.user });
      navigate(APP_ROUTES.dashboard);
    } catch {
      setError("Invalid verification code");
      setLoading(false);
    }
  };

  const getStatusIcon = () => {
    switch(systemStatus) {
      case 'online':
        return <Wifi className="text-accent" size={14} />;
      case 'degraded':
        return <AlertCircle className="text-warning" size={14} />;
      case 'offline':
        return <WifiOff className="text-danger" size={14} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Industrial Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_20%_20%,rgba(116,149,154,0.15),transparent_50%)]"></div>
        <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_80%_80%,rgba(73,83,113,0.15),transparent_50%)]"></div>
      </div>

      {/* System Status Bar */}
      <div className="absolute top-4 right-4 flex items-center space-x-3 glass px-4 py-2 rounded-full">
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <span className="text-xs font-medium">
            System: <span className={
              systemStatus === 'online' ? 'text-accent' :
              systemStatus === 'degraded' ? 'text-warning' : 'text-danger'
            }>
              {systemStatus.charAt(0).toUpperCase() + systemStatus.slice(1)}
            </span>
          </span>
        </div>
        <div className="w-px h-4 bg-border"></div>
        <div className="flex items-center space-x-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
              <User size={16} className="text-bg-dark" />
            </div>
          <span className="text-xs text-text-muted">v2.1.0</span>
        </div>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-md relative rise-in">
        {/* Decorative Elements */}
        <div className="absolute -top-4 -left-4 w-24 h-24 border border-primary/20 rounded-lg"></div>
        <div className="absolute -bottom-4 -right-4 w-24 h-24 border border-accent/20 rounded-lg"></div>

        <div className="industrial-card p-8 space-y-8 bg-bg-card/70 backdrop-blur-xl border border-primary/10 relative">
          {/* Header with Industrial Design */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 text-primary relative shadow-2xl shadow-primary/5">
              <Lock size={40} className="text-primary" />
              <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-bg-card rounded-xl border border-primary/20 flex items-center justify-center shadow-lg shadow-black/50">
                <QrCode size={16} className="text-accent" />
              </div>
            </div>
            
            <div className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight text-white">Industrial Access</h1>
              <p className="text-text-muted text-sm flex items-center justify-center space-x-2">
                <span className="w-8 h-px bg-border"></span>
                <span>Traceability & Monitoring System</span>
                <span className="w-8 h-px bg-border"></span>
              </p>
            </div>
          </div>

          {/* Error Alert with Animation */}
          {error && (
            <div className="flex items-center space-x-3 p-4 bg-danger/10 border border-danger/30 rounded-lg text-danger text-sm animate-shake">
              <ShieldAlert size={18} className="flex-shrink-0" />
              <span className="flex-1">{error}</span>
              <button 
                onClick={() => setError("")}
                className="hover:bg-danger/20 p-1 rounded"
              >
                <AlertCircle size={14} />
              </button>
            </div>
          )}

          {!showMfa ? (
            // Standard Login Form
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-4">
                {/* Username Field */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-text-muted ml-1 flex items-center justify-between">
                    <span>Username <span className="text-primary">*</span></span>
                  </label>
                  <div className="relative group">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors" size={18} />
                    <input
                      type="text"
                      placeholder="Enter your username"
                      className="w-full bg-bg-dark border border-border rounded-lg py-3 pl-10 pr-4 text-text-main focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-text-muted ml-1 flex items-center justify-between">
                    <span>Secure Key <span className="text-primary">*</span></span>
                  </label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors" size={18} />
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="w-full bg-bg-dark border border-border rounded-lg py-3 pl-10 pr-12 text-text-main focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* Options */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 bg-bg-dark border border-border rounded focus:ring-primary focus:ring-offset-0"
                    />
                    <span className="text-sm text-text-muted">Remember me</span>
                  </label>
                  <button
                    type="button"
                    className="text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    Forgot Secure Key?
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:brightness-110 text-bg-dark font-bold py-3.5 rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group font-outfit uppercase tracking-wider"
              >
                {loading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-5 h-5 border-2 border-bg-dark border-t-transparent rounded-full animate-spin"></div>
                    <span>Authenticating...</span>
                  </div>
                ) : (
                  <span className="flex items-center justify-center space-x-2">
                    <Fingerprint size={20} />
                    <span>Authorize Access</span>
                  </span>
                )}
              </button>
            </form>
          ) : (
            // MFA Verification Form
            <form onSubmit={handleMfaSubmit} className="space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border border-primary/30 mb-2">
                  <Fingerprint size={32} className="text-primary" />
                </div>
                <h2 className="text-xl font-bold text-white">Two-Factor Authentication</h2>
                <p className="text-sm text-text-muted">Enter the verification code from your authenticator app</p>
              </div>

              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="000000"
                  maxLength="6"
                  className="w-full bg-bg-dark border border-border rounded-lg py-3 px-4 text-center text-2xl tracking-widest font-mono text-text-main focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || mfaCode.length !== 6}
                className="w-full bg-primary hover:bg-primary/80 text-white font-bold py-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Verifying...</span>
                  </div>
                ) : (
                  "Verify & Login"
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowMfa(false)}
                className="w-full text-text-muted hover:text-text-main text-sm transition-colors"
              >
                Back to login
              </button>
            </form>
          )}

          {/* Footer */}
          <div className="text-center pt-4 border-t border-border">
            <div className="flex items-center justify-center space-x-4 text-xs">
              <span className="text-text-muted flex items-center space-x-1">
                <span className="w-2 h-2 bg-accent rounded-full animate-pulse"></span>
                <span>Secure Connection</span>
              </span>
              <span className="text-text-muted">•</span>
              <span className="text-text-muted">AES-256 Encryption</span>
            </div>
            <p className="text-text-muted text-[10px] uppercase tracking-widest mt-3">
              Authorized Personnel Only • All activities are monitored
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
