import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell, Search, User, ChevronDown, Clock, AlertCircle,
  CheckCircle, LogOut, Menu, ArrowUpRight, X,
} from "lucide-react";
import { clearAuthSession, getUserRole } from "../utils/authStorage";
import { APP_ROUTES } from "../constants/routes";
import ThemeToggleButton from "./ThemeToggleButton";
import NetworkSignal from "./NetworkSignal";
import { useNotifications } from "../context/NotificationContext";
import { canAccessModule, getRoleAccessSettings } from "../utils/roleAccess";

const SEARCHABLE_PAGES = [
  { name: "Dashboard", path: APP_ROUTES.dashboard, moduleKey: "dashboard", description: "Summary, quality and trends", keywords: ["oee", "summary", "trends"] },
  { name: "Operator View", path: APP_ROUTES.operatorView, moduleKey: "operator_view", description: "Live operator workstation", keywords: ["operator", "station"] },
  { name: "Production", path: APP_ROUTES.production, moduleKey: "production", description: "Production charts and reports", keywords: ["charts", "report", "output"] },
  { name: "Traceability", path: APP_ROUTES.traceability, description: "Track part lifecycle and scans", keywords: ["part", "scan", "history"] },
  { name: "I/O Monitor", path: APP_ROUTES.ioMonitor, moduleKey: "io_monitor", description: "PLC and signal status", keywords: ["io", "plc", "monitor"] },
  { name: "Scanner Monitor", path: APP_ROUTES.scannerMonitor, moduleKey: "scanners", description: "Scanner connection health", keywords: ["scanner", "device"] },
  { name: "Part Journey", path: APP_ROUTES.partJourney, moduleKey: "part_journey", description: "Part operation sequence", keywords: ["journey", "operation"] },
  { name: "Packing", path: APP_ROUTES.packing, moduleKey: "packing", description: "Packing execution", keywords: ["box", "scan"] },
  { name: "Packing Management", path: APP_ROUTES.packingManagement, moduleKey: "packing_management", description: "Packing setup and controls", keywords: ["management", "settings"] },
  { name: "Role Access", path: APP_ROUTES.masterSettings, moduleKey: "master_settings", description: "Role permissions", keywords: ["roles", "permissions"] },
  { name: "Station Controls", path: APP_ROUTES.stationControls, moduleKey: "master_settings", description: "Station configuration", keywords: ["station", "controls"] },
  { name: "Report Config", path: APP_ROUTES.masterReports, moduleKey: "master_settings", description: "Master report configuration", keywords: ["report", "config"] },
  { name: "Machine Manager", path: APP_ROUTES.machines, moduleKey: "machines", description: "Machine setup", keywords: ["machine", "line"] },
  { name: "PLC Manager", path: APP_ROUTES.plcConfig, moduleKey: "plc_config", description: "PLC communication setup", keywords: ["plc", "register"] },
  { name: "Scanner Manager", path: APP_ROUTES.scanners, moduleKey: "scanners", description: "Scanner setup", keywords: ["scanner", "config"] },
  { name: "Shift Manager", path: APP_ROUTES.shifts, moduleKey: "shifts", description: "Shift timings and status", keywords: ["shift", "time"] },
  { name: "QR Manager", path: APP_ROUTES.qrRules, moduleKey: "qr_rules", description: "QR parsing rules", keywords: ["qr", "format"] },
  { name: "User Management", path: APP_ROUTES.users, moduleKey: "users", description: "User accounts and roles", keywords: ["users", "admin"] },
];

const Header = ({ onMenuClick }) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const searchContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const mobileSearchInputRef = useRef(null);
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const userRole = getUserRole();
  const roleAccessSettings = useMemo(() => getRoleAccessSettings(), []);
  const { notifications, markAsRead, markAllRead } = useNotifications();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const formatUserField = (value, fallback) => {
    if (typeof value === "string" && value.trim()) return value;
    return fallback;
  };

  const visiblePages = useMemo(
    () => SEARCHABLE_PAGES.filter((entry) => !entry.moduleKey || canAccessModule(userRole, entry.moduleKey, roleAccessSettings)),
    [roleAccessSettings, userRole]
  );

  const suggestions = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return visiblePages.slice(0, 7);
    }

    return visiblePages
      .map((entry) => {
        const haystack = [entry.name, entry.description, entry.path, ...(entry.keywords || [])]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return null;
        }
        let score = 1;
        if (entry.name.toLowerCase().startsWith(query)) score += 6;
        if (entry.path.toLowerCase().includes(query)) score += 2;
        if ((entry.keywords || []).some((keyword) => keyword.toLowerCase().startsWith(query))) score += 3;
        return { ...entry, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 7);
  }, [searchValue, visiblePages]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [searchValue]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const timer = setTimeout(() => mobileSearchInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [mobileSearchOpen]);

  useEffect(() => {
    setMobileSearchOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!searchContainerRef.current?.contains(event.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const onGlobalShortcut = (event) => {
      const isK = event.key.toLowerCase() === "k";
      const inEditableField = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if ((event.ctrlKey || event.metaKey) && isK) {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      } else if (!inEditableField && event.key === "/") {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onGlobalShortcut);
    return () => document.removeEventListener("keydown", onGlobalShortcut);
  }, []);

  const handleLogout = () => {
    clearAuthSession();
    navigate(APP_ROUTES.login, { replace: true });
  };

  const getNotificationIcon = (type) => {
    if (type === "warning") return <AlertCircle size={16} className="text-warning" />;
    if (type === "success") return <CheckCircle size={16} className="text-accent" />;
    return <Bell size={16} className="text-primary" />;
  };

  const navigateToPage = (page) => {
    if (!page?.path) return;
    navigate(page.path);
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setSearchValue("");
  };

  const handleSearchKeyDown = (event) => {
    if (!searchOpen) {
      setSearchOpen(true);
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (suggestions.length > 0) {
        setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (suggestions.length > 0) {
        setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = suggestions[activeSuggestionIndex] || suggestions[0];
      if (target) {
        navigateToPage(target);
      }
    } else if (event.key === "Escape") {
      setSearchOpen(false);
      setMobileSearchOpen(false);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 h-16 bg-bg-card/70 backdrop-blur-xl border-b border-border/60 flex items-center justify-between px-4 sm:px-6 gap-3 flex-shrink-0">
        <button
          onClick={onMenuClick}
          className="p-2 hover:bg-bg-hover rounded-lg transition-colors lg:hidden flex-shrink-0"
          aria-label="Open sidebar"
        >
          <Menu size={20} />
        </button>

        <div ref={searchContainerRef} className="relative flex-1 min-w-0 max-w-sm md:max-w-md hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search pages..."
            className="w-full bg-bg-elevated border border-border rounded-xl py-2 pl-9 pr-4 text-sm text-text-main focus:outline-none focus:border-primary/60 transition-colors"
          />

          {searchOpen && (
            <div className="absolute top-[calc(100%+8px)] left-0 right-0 bg-bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-[11px] tracking-wide uppercase text-text-muted">
                {searchValue.trim() ? "Suggestions" : "Recommended Pages"}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {suggestions.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-text-muted text-center">
                    No page matches this search.
                  </div>
                ) : (
                  suggestions.map((item, index) => {
                    const isActive = index === activeSuggestionIndex;
                    const isCurrentPage = location.pathname === item.path;
                    return (
                      <button
                        key={item.path}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => navigateToPage(item)}
                        className={`w-full text-left px-4 py-3 border-b border-border/50 last:border-b-0 transition-colors ${isActive ? "bg-primary/10" : "hover:bg-bg-hover/60"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-text-main truncate">{item.name}</p>
                            <p className="text-xs text-text-muted truncate">{item.description}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {isCurrentPage && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                                Current
                              </span>
                            )}
                            <ArrowUpRight size={14} className="text-text-muted" />
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              setMobileSearchOpen(true);
              setSearchOpen(true);
            }}
            className="sm:hidden p-2 hover:bg-bg-hover rounded-xl transition-colors"
            aria-label="Open search"
          >
            <Search size={18} />
          </button>

        <NetworkSignal />
        <ThemeToggleButton className="px-2 sm:px-2" />

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

      {mobileSearchOpen && (
        <div className="fixed inset-0 z-[70] sm:hidden">
          <button
            type="button"
            aria-label="Close search"
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setMobileSearchOpen(false);
              setSearchOpen(false);
            }}
          />
          <div className="absolute top-3 left-3 right-3 bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
              <Search size={16} className="text-text-muted flex-shrink-0" />
              <input
                ref={mobileSearchInputRef}
                type="text"
                value={searchValue}
                onChange={(event) => {
                  setSearchValue(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search pages..."
                className="flex-1 bg-transparent text-sm text-text-main focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSearchOpen(false);
                }}
                className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-3 py-2 border-b border-border text-[11px] tracking-wide uppercase text-text-muted">
              {searchValue.trim() ? "Suggestions" : "Recommended Pages"}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {suggestions.length === 0 ? (
                <div className="px-4 py-8 text-sm text-text-muted text-center">
                  No page matches this search.
                </div>
              ) : (
                suggestions.map((item, index) => {
                  const isActive = index === activeSuggestionIndex;
                  const isCurrentPage = location.pathname === item.path;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => navigateToPage(item)}
                      className={`w-full text-left px-4 py-3 border-b border-border/50 last:border-b-0 transition-colors ${isActive ? "bg-primary/10" : "hover:bg-bg-hover/60"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-main truncate">{item.name}</p>
                          <p className="text-xs text-text-muted truncate">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isCurrentPage && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                              Current
                            </span>
                          )}
                          <ArrowUpRight size={14} className="text-text-muted" />
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
