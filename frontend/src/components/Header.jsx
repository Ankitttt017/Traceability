// components/Header.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, Search, User, ChevronDown, Clock, AlertCircle,
  CheckCircle, LogOut, Menu,
} from "lucide-react";
import { clearAuthSession } from "../utils/authStorage";
import { APP_ROUTES } from "../constants/routes";
import ThemeToggleButton from "./ThemeToggleButton";
import { useNotifications } from "../context/NotificationContext";

const Header = ({ onMenuClick }) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const { notifications, markAsRead, markAllRead } = useNotifications();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const formatUserField = (value, fallback) => {
    if (typeof value === "string" && value.trim()) return value;
    return fallback;
  };


  const handleLogout = () => {
    clearAuthSession();
    navigate(APP_ROUTES.login, { replace: true });
  };

  const getNotificationIcon = (type) => {
    if (type === "warning") return <AlertCircle size={16} className="text-warning" />;
    if (type === "success") return <CheckCircle size={16} className="text-accent" />;
    return <Bell size={16} className="text-primary" />;
  };

  return (
    <header className="sticky top-0 z-40 h-16 bg-bg-card/70 backdrop-blur-xl border-b border-border/60 flex items-center justify-between px-4 sm:px-6 gap-3 flex-shrink-0">

      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="p-2 hover:bg-bg-hover rounded-lg transition-colors lg:hidden flex-shrink-0"
        aria-label="Open sidebar"
      >
        <Menu size={20} />
      </button>

      {/* Search */}
      <div className="flex-1 max-w-xs sm:max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
          <input
            type="text"
            placeholder="Search machines, parts..."
            className="w-full bg-bg-elevated border border-border rounded-xl py-2 pl-9 pr-4 text-sm text-text-main focus:outline-none focus:border-primary/60 transition-colors"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        <ThemeToggleButton  className="hidden sm:inline-flex" />
        <ThemeToggleButton className="sm:hidden" />

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => { setShowNotifications((p) => !p); setShowProfile(false); }}
            className="relative p-2 hover:bg-bg-hover rounded-xl transition-colors"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-danger rounded-full" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex justify-between items-center">
                <h3 className="font-bold text-sm">Notifications</h3>
                <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                  Mark all as read
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-text-muted text-center">No notifications</div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`px-4 py-3 hover:bg-bg-hover/60 cursor-pointer transition-colors ${!notif.read ? "bg-primary/5" : ""}`}
                      onClick={() => markAsRead(notif.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex-shrink-0">{getNotificationIcon(notif.type)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-main">{notif.message}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Clock size={11} className="text-text-muted" />
                            <span className="text-xs text-text-muted">{notif.time}</span>
                          </div>
                        </div>
                        {!notif.read && <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1" />}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="relative">
          <button
            onClick={() => { setShowProfile((p) => !p); setShowNotifications(false); }}
            className="flex items-center gap-2 p-2 hover:bg-bg-hover rounded-xl transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md">
              <User size={14} className="text-white" />
            </div>
            <ChevronDown size={14} className="hidden sm:block" />
          </button>

          {showProfile && (
            <div className="absolute right-0 mt-2 w-52 bg-bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="font-semibold text-sm text-text-main">
                  {formatUserField(user.username, "User")}
                </p>
                <p className="text-xs text-text-muted capitalize mt-0.5">
                  {formatUserField(user.role, "Operator")}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-3 text-danger hover:bg-danger/10 transition-colors"
              >
                <LogOut size={15} />
                <span className="text-sm font-medium">Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
