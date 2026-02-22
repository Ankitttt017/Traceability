// components/Header.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Bell, 
  Search, 
  User,
  ChevronDown,
  Clock,
  AlertCircle,
  CheckCircle,
  LogOut
} from "lucide-react";
import { clearAuthSession } from "../utils/authStorage";
import { APP_ROUTES } from "../constants/routes";
import ThemeToggleButton from "./ThemeToggleButton";

const Header = () => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const [notifications, setNotifications] = useState([
    { id: 1, message: "Machine M-101 maintenance due", type: "warning", time: "5 min ago", read: false },
    { id: 2, message: "Batch #B-2024 completed successfully", type: "success", time: "1 hour ago", read: false },
    { id: 3, message: "New user registered", type: "info", time: "2 hours ago", read: true },
  ]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const formatUserField = (value, fallback) => {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    return fallback;
  };

  const markAsRead = (id) => {
    setNotifications(notifications.map(n => 
      n.id === id ? { ...n, read: true } : n
    ));
  };

  const handleLogout = () => {
    clearAuthSession();
    navigate(APP_ROUTES.login, { replace: true });
  };

  const getNotificationIcon = (type) => {
    switch(type) {
      case 'warning': return <AlertCircle size={16} className="text-warning" />;
      case 'success': return <CheckCircle size={16} className="text-accent" />;
      default: return <Bell size={16} className="text-primary" />;
    }
  };

  return (
    <header className="h-16 bg-bg-card/50 backdrop-blur-xl border-b border-border/50 flex items-center justify-between px-6">
      {/* Search Bar */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
          <input
            type="text"
            placeholder="Search machines, batches, users..."
            className="w-full bg-bg-dark border border-border rounded-lg py-2 pl-10 pr-4 text-sm text-text-main focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center space-x-4">
        <ThemeToggleButton showLabel className="hidden sm:inline-flex" />
        <ThemeToggleButton className="sm:hidden" />

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 hover:bg-bg-dark rounded-lg transition-colors"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-danger rounded-full"></span>
            )}
          </button>

          {/* Notifications Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-bg-card border border-border rounded-lg shadow-xl z-50">
              <div className="p-3 border-b border-border flex justify-between items-center">
                <h3 className="font-bold">Notifications</h3>
                <button className="text-xs text-primary">Mark all as read</button>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`p-3 border-b border-border/50 hover:bg-bg-dark cursor-pointer ${
                      !notif.read ? 'bg-primary/5' : ''
                    }`}
                    onClick={() => markAsRead(notif.id)}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="mt-1">{getNotificationIcon(notif.type)}</div>
                      <div className="flex-1">
                        <p className="text-sm">{notif.message}</p>
                        <div className="flex items-center space-x-2 mt-1">
                          <Clock size={12} className="text-text-muted" />
                          <span className="text-xs text-text-muted">{notif.time}</span>
                        </div>
                      </div>
                      {!notif.read && <div className="w-2 h-2 bg-primary rounded-full"></div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Profile Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="flex items-center space-x-3 p-2 hover:bg-bg-dark rounded-lg transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-accent flex items-center justify-center">
              <User size={16} className="text-white" />
            </div>
            <ChevronDown size={16} />
          </button>

          {showProfile && (
            <div className="absolute right-0 mt-2 w-56 bg-bg-card border border-border rounded-lg shadow-xl z-50">
              <div className="p-3 border-b border-border">
                <p className="font-medium text-sm text-text-main">
                  {formatUserField(user.username, "User")}
                </p>
                <p className="text-xs text-text-muted">
                  {formatUserField(user.role, "Operator")}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center space-x-2 px-3 py-3 text-rose-400 hover:bg-rose-400/10 transition-colors"
              >
                <LogOut size={16} />
                <span className="text-sm font-medium">Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
