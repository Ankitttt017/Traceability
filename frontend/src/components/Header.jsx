import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Search,
  User,
  ChevronDown,
  Clock,
  AlertCircle,
  CheckCircle,
  LogOut,
  Menu,
  ArrowUpRight,
  X,
  CircleHelp,
  Languages,
  Check,
} from "lucide-react";

import { clearAuthSession, getUserRole } from "../utils/authStorage";
import { APP_ROUTES } from "../constants/routes";
import ThemeToggleButton from "./ThemeToggleButton";
import NetworkSignal from "./NetworkSignal";
import { useNotifications } from "../context/NotificationContext";
import { canAccessModule, getRoleAccessSettings } from "../utils/roleAccess";
import { useLanguage } from "../context/LanguageContext";

const Header = ({ onMenuClick }) => {
  const { language, setLanguage, t } = useLanguage();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  const navigate = useNavigate();
  const location = useLocation();
  const searchContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const mobileSearchInputRef = useRef(null);
  const languageMenuRef = useRef(null);
  const profileMenuRef = useRef(null);
  const notificationMenuRef = useRef(null);
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const userRole = getUserRole();
  const roleAccessSettings = useMemo(() => getRoleAccessSettings(), []);
  const { notifications, markAsRead, markAllRead } = useNotifications();

  const unreadCount = notifications.filter((entry) => !entry.read).length;

  const searchablePages = useMemo(
    () => [
      {
        name: t("pages.dashboard", "Dashboard"),
        path: APP_ROUTES.dashboard,
        moduleKey: "dashboard",
        description: "Summary, quality and trends",
        keywords: ["oee", "summary", "trends"],
      },
      {
        name: t("pages.operatorView", "Operator View"),
        path: APP_ROUTES.operatorView,
        moduleKey: "operator_view",
        description: "Live operator workstation",
        keywords: ["operator", "station"],
      },
      {
        name: t("pages.production", "Production"),
        path: APP_ROUTES.production,
        moduleKey: "production",
        description: "Production charts and reports",
        keywords: ["charts", "report", "output"],
      },
      {
        name: t("pages.traceability", "Traceability"),
        path: APP_ROUTES.traceability,
        description: "Track part lifecycle and scans",
        keywords: ["part", "scan", "history"],
      },
      {
        name: t("pages.ioMonitor", "I/O Monitor"),
        path: APP_ROUTES.ioMonitor,
        moduleKey: "io_monitor",
        description: "PLC and signal status",
        keywords: ["io", "plc", "monitor"],
      },
      {
        name: t("pages.scannerMonitor", "Scanner Monitor"),
        path: APP_ROUTES.scannerMonitor,
        moduleKey: "scanners",
        description: "Scanner connection health",
        keywords: ["scanner", "device"],
      },
      {
        name: t("pages.partJourney", "Part Journey"),
        path: APP_ROUTES.partJourney,
        moduleKey: "part_journey",
        description: "Part operation sequence",
        keywords: ["journey", "operation"],
      },
      {
        name: t("pages.packing", "Packing"),
        path: APP_ROUTES.packing,
        moduleKey: "packing",
        description: "Packing execution",
        keywords: ["box", "scan"],
      },
      {
        name: t("pages.packingManagement", "Packing Management"),
        path: APP_ROUTES.packingManagement,
        moduleKey: "packing_management",
        description: "Packing setup and controls",
        keywords: ["management", "settings"],
      },
      {
        name: t("pages.roleAccess", "Role Access"),
        path: APP_ROUTES.masterSettings,
        moduleKey: "master_settings",
        description: "Role permissions",
        keywords: ["roles", "permissions"],
      },
      {
        name: t("pages.stationControls", "Station Controls"),
        path: APP_ROUTES.stationControls,
        moduleKey: "master_settings",
        description: "Station configuration",
        keywords: ["station", "controls"],
      },
      {
        name: t("pages.reportConfig", "Report Config"),
        path: APP_ROUTES.masterReports,
        moduleKey: "master_settings",
        description: "Master report configuration",
        keywords: ["report", "config"],
      },
      {
        name: t("pages.machineManager", "Machine Manager"),
        path: APP_ROUTES.machines,
        moduleKey: "machines",
        description: "Machine setup",
        keywords: ["machine", "line"],
      },
      {
        name: t("pages.plcManager", "PLC Manager"),
        path: APP_ROUTES.plcConfig,
        moduleKey: "plc_config",
        description: "PLC communication setup",
        keywords: ["plc", "register"],
      },
      {
        name: t("pages.scannerManager", "Scanner Manager"),
        path: APP_ROUTES.scanners,
        moduleKey: "scanners",
        description: "Scanner setup",
        keywords: ["scanner", "config"],
      },
      {
        name: t("pages.shiftManager", "Shift Manager"),
        path: APP_ROUTES.shifts,
        moduleKey: "shifts",
        description: "Shift timings and status",
        keywords: ["shift", "time"],
      },
      {
        name: t("pages.qrManager", "QR Manager"),
        path: APP_ROUTES.qrRules,
        moduleKey: "qr_rules",
        description: "QR parsing rules",
        keywords: ["qr", "format"],
      },
      {
        name: t("pages.userManagement", "User Management"),
        path: APP_ROUTES.users,
        moduleKey: "users",
        description: "User accounts and roles",
        keywords: ["users", "admin"],
      },
      {
        name: t("pages.faq", "FAQ & Logic Guide"),
        path: APP_ROUTES.faq,
        description: "KPI formulas and rejection categories",
        keywords: ["faq", "logic", "oee", "oa", "formula"],
      },
    ],
    [t]
  );

  const visiblePages = useMemo(
    () =>
      searchablePages.filter(
        (entry) => !entry.moduleKey || canAccessModule(userRole, entry.moduleKey, roleAccessSettings)
      ),
    [roleAccessSettings, searchablePages, userRole]
  );

  const suggestions = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return visiblePages.slice(0, 7);

    return visiblePages
      .map((entry) => {
        const haystack = [entry.name, entry.description, entry.path, ...(entry.keywords || [])]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return null;

        let score = 1;
        if (entry.name.toLowerCase().startsWith(query)) score += 6;
        if (entry.path.toLowerCase().includes(query)) score += 2;
        if ((entry.keywords || []).some((keyword) => keyword.toLowerCase().startsWith(query))) {
          score += 3;
        }

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
    if (!mobileSearchOpen) return undefined;
    const timer = setTimeout(() => mobileSearchInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [mobileSearchOpen]);

  useEffect(() => {
    setMobileSearchOpen(false);
    setSearchOpen(false);
    setShowLanguageMenu(false);
    setShowProfile(false);
    setShowNotifications(false);
  }, [location.pathname]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!searchContainerRef.current?.contains(event.target)) {
        setSearchOpen(false);
      }
      if (!languageMenuRef.current?.contains(event.target)) {
        setShowLanguageMenu(false);
      }
      if (!profileMenuRef.current?.contains(event.target)) {
        setShowProfile(false);
      }
      if (!notificationMenuRef.current?.contains(event.target)) {
        setShowNotifications(false);
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

  const formatUserField = (value, fallback) => {
    if (typeof value === "string" && value.trim()) return value;
    return fallback;
  };

  const handleLogout = () => {
    clearAuthSession();
    navigate(APP_ROUTES.login, { replace: true });
  };

  const navigateToPage = (page) => {
    if (!page?.path) return;
    navigate(page.path);
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setSearchValue("");
  };

  const getNotificationIcon = (type) => {
    if (type === "warning") return <AlertCircle size={16} className="text-warning" />;
    if (type === "success") return <CheckCircle size={16} className="text-accent" />;
    return <Bell size={16} className="text-primary" />;
  };

  const handleSearchKeyDown = (event) => {
    if (!searchOpen) setSearchOpen(true);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((prev) => (prev + 1) % Math.max(suggestions.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((prev) => (prev - 1 + suggestions.length) % Math.max(suggestions.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = suggestions[activeSuggestionIndex];
      if (selected) navigateToPage(selected);
    } else if (event.key === "Escape") {
      setSearchOpen(false);
      setMobileSearchOpen(false);
    }
  };

  const languageOptions = [
    { code: "en", label: t("common.english", "English") },
    { code: "hi", label: t("common.hindi", "Hindi") },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 h-14 border-b border-border/60 bg-bg-card/85 backdrop-blur-xl px-3 sm:px-4 lg:px-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onMenuClick}
            className="lg:hidden p-2 rounded-xl hover:bg-bg-hover transition-colors text-text-main"
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>

          <div ref={searchContainerRef} className="hidden sm:block relative w-full max-w-xs md:max-w-sm">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-hover/40 px-3 py-2">
              <Search size={16} className="text-text-muted" />
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
                placeholder={t("header.searchPlaceholder", "Search pages...")}
                className="w-full bg-transparent text-sm text-text-main placeholder:text-text-muted focus:outline-none"
              />
            </div>

            {searchOpen && (
              <div className="absolute left-0 right-0 mt-2 overflow-hidden rounded-2xl border border-border bg-bg-card shadow-2xl">
                <div className="px-4 py-2.5 border-b border-border text-[11px] tracking-wide uppercase text-text-muted">
                  {searchValue.trim()
                    ? t("header.suggestions", "Suggestions")
                    : t("header.recommendedPages", "Recommended Pages")}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {suggestions.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-text-muted text-center">
                      {t("header.noMatches", "No page matches this search.")}
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
                          className={`w-full text-left px-4 py-3 border-b border-border/50 last:border-b-0 transition-colors ${
                            isActive ? "bg-primary/10" : "hover:bg-bg-hover/60"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-text-main truncate">{item.name}</p>
                              <p className="text-xs text-text-muted truncate">{item.description}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {isCurrentPage && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                                  {t("header.currentPage", "Current")}
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
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setMobileSearchOpen(true)}
            className="sm:hidden p-2 rounded-xl hover:bg-bg-hover text-text-main"
            aria-label={t("header.searchPlaceholder", "Search pages...")}
          >
            <Search size={18} />
          </button>

          <div ref={languageMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setShowLanguageMenu((prev) => !prev);
                setShowNotifications(false);
                setShowProfile(false);
              }}
              className="flex items-center justify-center rounded-lg border border-border bg-bg-hover/40 px-2 py-1.5 text-text-main hover:bg-bg-hover transition-colors"
              aria-label={t("header.languageSwitcher", "Change language")}
              title={t("header.languageSwitcher", "Change language")}
            >
              <Languages size={15} />
              <ChevronDown size={12} className="hidden sm:block" />
            </button>

            {showLanguageMenu && (
              <div className="absolute right-0 mt-2 w-36 overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl z-50">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-semibold text-text-main">
                    {t("common.language", "Language")}
                  </p>
                </div>
                {languageOptions.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    onClick={() => {
                      setLanguage(option.code);
                      setShowLanguageMenu(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-text-main hover:bg-bg-hover transition-colors"
                  >
                    <span>{option.label}</span>
                    {language === option.code && <Check size={15} className="text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ThemeToggleButton />
          <NetworkSignal />

          <div ref={notificationMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setShowNotifications((prev) => !prev);
                setShowProfile(false);
                setShowLanguageMenu(false);
              }}
              className="relative p-2 rounded-xl hover:bg-bg-hover transition-colors text-text-main"
              aria-label={t("header.notifications", "Notifications")}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-danger rounded-full" />
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex justify-between items-center">
                  <h3 className="font-bold text-sm">{t("header.notifications", "Notifications")}</h3>
                  <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                    {t("header.markAllRead", "Mark all as read")}
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-text-muted text-center">
                      {t("header.noNotifications", "No notifications")}
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`px-4 py-3 hover:bg-bg-hover/60 cursor-pointer transition-colors ${
                          !notif.read ? "bg-primary/5" : ""
                        }`}
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

          <div ref={profileMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setShowProfile((prev) => !prev);
                setShowNotifications(false);
                setShowLanguageMenu(false);
              }}
              className="flex items-center gap-2 p-2 hover:bg-bg-hover rounded-xl transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md">
                <User size={14} className="text-white" />
              </div>
              <ChevronDown size={14} className="hidden sm:block" />
            </button>

            {showProfile && (
              <div className="absolute right-0 mt-2 w-56 bg-bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="font-semibold text-sm text-text-main">
                    {formatUserField(user.username, t("header.profileUser", "User"))}
                  </p>
                  <p className="text-xs text-text-muted capitalize mt-0.5">
                    {formatUserField(user.role, t("header.profileOperator", "Operator"))}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    navigate(APP_ROUTES.faq);
                    setShowProfile(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-text-main hover:bg-bg-hover transition-colors"
                >
                  <CircleHelp size={15} />
                  <span className="text-sm font-medium">{t("header.faq", "FAQ")}</span>
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-3 text-danger hover:bg-danger/10 transition-colors border-t border-border/70"
                >
                  <LogOut size={15} />
                  <span className="text-sm font-medium">{t("header.signOut", "Sign Out")}</span>
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
            aria-label={t("common.close", "Close")}
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
                placeholder={t("header.searchPlaceholder", "Search pages...")}
                className="flex-1 bg-transparent text-sm text-text-main focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSearchOpen(false);
                }}
                className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted"
                aria-label={t("common.close", "Close")}
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-3 py-2 border-b border-border text-[11px] tracking-wide uppercase text-text-muted">
              {searchValue.trim()
                ? t("header.suggestions", "Suggestions")
                : t("header.recommendedPages", "Recommended Pages")}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {suggestions.length === 0 ? (
                <div className="px-4 py-8 text-sm text-text-muted text-center">
                  {t("header.noMatches", "No page matches this search.")}
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
                      className={`w-full text-left px-4 py-3 border-b border-border/50 last:border-b-0 transition-colors ${
                        isActive ? "bg-primary/10" : "hover:bg-bg-hover/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-main truncate">{item.name}</p>
                          <p className="text-xs text-text-muted truncate">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isCurrentPage && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                              {t("header.currentPage", "Current")}
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
