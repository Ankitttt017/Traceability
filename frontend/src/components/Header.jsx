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
  Sparkles,
  Gem,
  Command,
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
        icon: "📊",
      },
      {
        name: t("pages.operatorView", "Operator View"),
        path: APP_ROUTES.operatorView,
        moduleKey: "operator_view",
        description: "Live operator workstation",
        keywords: ["operator", "station"],
        icon: "🖥️",
      },
      {
        name: t("pages.traceability", "Traceability"),
        path: APP_ROUTES.traceability,
        moduleKey: "traceability",
        description: "Track part lifecycle and scans",
        keywords: ["part", "scan", "history"],
        icon: "🔍",
      },
      {
        name: t("pages.ioMonitor", "I/O Monitor"),
        path: APP_ROUTES.ioMonitor,
        moduleKey: "io_monitor",
        description: "PLC and signal status",
        keywords: ["io", "plc", "monitor"],
        icon: "⚡",
      },
      {
        name: t("pages.scannerMonitor", "Scanner Monitor"),
        path: APP_ROUTES.scannerMonitor,
        moduleKey: "scanner_monitor",
        description: "Scanner connection health",
        keywords: ["scanner", "device"],
        icon: "📡",
      },
      {
        name: t("pages.partJourney", "Part Journey"),
        path: APP_ROUTES.partJourney,
        moduleKey: "part_journey",
        description: "Part operation sequence",
        keywords: ["journey", "operation"],
        icon: "🔄",
      },
      {
        name: t("pages.packing", "Packing"),
        path: APP_ROUTES.packing,
        moduleKey: "packing",
        description: "Packing execution",
        keywords: ["box", "scan"],
        icon: "📦",
      },
      {
        name: t("pages.packingManagement", "Packing Management"),
        path: APP_ROUTES.packingManagement,
        moduleKey: "packing_management",
        description: "Packing setup and controls",
        keywords: ["management", "settings"],
        icon: "⚙️",
      },
      {
        name: t("pages.roleAccess", "Role Access"),
        path: APP_ROUTES.masterSettings,
        moduleKey: "master_settings",
        description: "Role permissions",
        keywords: ["roles", "permissions"],
        icon: "🔐",
      },
      {
        name: t("pages.stationControls", "Station Controls"),
        path: APP_ROUTES.stationControls,
        moduleKey: "station_control",
        description: "Station configuration",
        keywords: ["station", "controls"],
        icon: "🎮",
      },
      {
        name: t("pages.reportConfig", "Report Config"),
        path: APP_ROUTES.masterReports,
        moduleKey: "report_config",
        description: "Master report configuration",
        keywords: ["report", "config"],
        icon: "📋",
      },
      {
        name: t("pages.machineManager", "Machine Manager"),
        path: APP_ROUTES.machines,
        moduleKey: "machines",
        description: "Machine setup",
        keywords: ["machine", "line"],
        icon: "🏭",
      },
      {
        name: t("pages.plcManager", "PLC Manager"),
        path: APP_ROUTES.plcConfig,
        moduleKey: "plc_config",
        description: "PLC communication setup",
        keywords: ["plc", "register"],
        icon: "🔌",
      },
      {
        name: t("pages.scannerManager", "Scanner Manager"),
        path: APP_ROUTES.scanners,
        moduleKey: "scanners",
        description: "Scanner setup",
        keywords: ["scanner", "config"],
        icon: "📷",
      },
      {
        name: t("pages.shiftManager", "Shift Manager"),
        path: APP_ROUTES.shifts,
        moduleKey: "shifts",
        description: "Shift timings and status",
        keywords: ["shift", "time"],
        icon: "🕐",
      },
      {
        name: t("pages.qrManager", "QR Manager"),
        path: APP_ROUTES.qrRules,
        moduleKey: "qr_rules",
        description: "QR parsing rules",
        keywords: ["qr", "format"],
        icon: "📱",
      },
      {
        name: t("pages.userManagement", "User Management"),
        path: APP_ROUTES.users,
        moduleKey: "users",
        description: "User accounts and roles",
        keywords: ["users", "admin"],
        icon: "👥",
      },
      {
        name: t("pages.faq", "FAQ & Logic Guide"),
        path: APP_ROUTES.faq,
        moduleKey: "faq",
        description: "KPI formulas and rejection categories",
        keywords: ["faq", "logic", "oee", "oa", "formula"],
        icon: "❓",
      },
      {
        name: "Plant Manager",
        path: APP_ROUTES.plants,
        moduleKey: "plants",
        description: "Plant masters",
        keywords: ["plant", "organization"],
        icon: "🏗️",
      },
      {
        name: "Line Manager",
        path: APP_ROUTES.lines,
        moduleKey: "lines",
        description: "Line masters",
        keywords: ["line", "organization"],
        icon: "📏",
      },
      {
        name: "Part Manager",
        path: APP_ROUTES.parts,
        moduleKey: "parts",
        description: "Part masters",
        keywords: ["part", "organization"],
        icon: "🔧",
      },
      {
        name: t("pages.rejectionConfig", "Rejection Config"),
        path: APP_ROUTES.rejectionConfiguration,
        moduleKey: "rejection_config",
        description: "Rejection categories, views and zones",
        keywords: ["rejection", "ng", "configuration"],
        icon: "🚫",
      },
      {
        name: t("pages.rejectionAnalysis", "Rejection Analysis"),
        path: APP_ROUTES.rejectionAnalysis,
        moduleKey: "rejection_analysis",
        description: "Rejection analytics and reports",
        keywords: ["rejection", "analysis", "report"],
        icon: "📉",
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
    if (type === "warning") return <AlertCircle size={16} className="text-amber-500" />;
    if (type === "success") return <CheckCircle size={16} className="text-emerald-500" />;
    return <Bell size={16} className="text-blue-500" />;
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
      <header className="sticky top-0 z-40 h-16 border-b border-gray-200/60 bg-white/90 backdrop-blur-xl px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 shadow-sm shadow-gray-100/50">
        {/* Left Section */}
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={onMenuClick}
            className="xl:hidden p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-700"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

        

          {/* Search Bar */}
          <div ref={searchContainerRef} className="hidden sm:block relative flex-1 max-w-md">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all duration-200">
              <Search size={18} className="text-gray-400" />
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
                className="w-full bg-transparent text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
              />
              <kbd className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-gray-400 bg-white border border-gray-200 rounded-md shadow-sm">
                <Command size={10} /> K
              </kbd>
            </div>

            {/* Search Results */}
            {searchOpen && (
              <div className="absolute left-0 right-0 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-200/50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wide uppercase text-gray-500">
                    {searchValue.trim()
                      ? t("header.suggestions", "Suggestions")
                      : t("header.recommendedPages", "Recommended Pages")}
                  </span>
                  <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                    {suggestions.length} results
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto py-1">
                  {suggestions.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-gray-400 text-center">
                      <Search size={32} className="mx-auto opacity-20 mb-2" />
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
                          className={`w-full text-left px-4 py-3 transition-all duration-150 ${
                            isActive
                              ? "bg-blue-50 border-l-2 border-blue-500"
                              : "hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{item.icon || "📄"}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                                {isCurrentPage && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                                    Current
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400 truncate">{item.description}</p>
                            </div>
                            <ArrowUpRight size={14} className="text-gray-300 flex-shrink-0" />
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

        {/* Right Section */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Mobile Search */}
          <button
            type="button"
            onClick={() => setMobileSearchOpen(true)}
            className="sm:hidden p-2 rounded-xl hover:bg-gray-100 text-gray-700"
            aria-label={t("header.searchPlaceholder", "Search pages...")}
          >
            <Search size={20} />
          </button>

          {/* Language Switcher */}
          <div ref={languageMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setShowLanguageMenu((prev) => !prev);
                setShowNotifications(false);
                setShowProfile(false);
              }}
              className="flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-gray-700 hover:bg-gray-100 transition-all duration-200 gap-1.5"
              aria-label={t("header.languageSwitcher", "Change language")}
            >
              <Languages size={16} />
              <span className="text-xs font-medium hidden sm:block uppercase">{language}</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>

            {showLanguageMenu && (
              <div className="absolute right-0 mt-2 w-40 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-gray-200/50 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="px-3 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
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
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span>{option.label}</span>
                    {language === option.code && <Check size={16} className="text-blue-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ThemeToggleButton />
          <NetworkSignal />

          {/* Notifications */}
          <div ref={notificationMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setShowNotifications((prev) => !prev);
                setShowProfile(false);
                setShowLanguageMenu(false);
              }}
              className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-700"
              aria-label={t("header.notifications", "Notifications")}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-2xl shadow-2xl shadow-gray-200/50 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                  <h3 className="font-bold text-sm text-gray-800">
                    {t("header.notifications", "Notifications")}
                  </h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                    >
                      {t("header.markAllRead", "Mark all read")}
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-gray-400 text-center">
                      <Bell size={32} className="mx-auto opacity-20 mb-2" />
                      {t("header.noNotifications", "No notifications")}
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                          !notif.read ? "bg-blue-50/50" : ""
                        }`}
                        onClick={() => markAsRead(notif.id)}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex-shrink-0">{getNotificationIcon(notif.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-700">{notif.message}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Clock size={11} className="text-gray-400" />
                              <span className="text-xs text-gray-400">{notif.time}</span>
                            </div>
                          </div>
                          {!notif.read && (
                            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile */}
          <div ref={profileMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setShowProfile((prev) => !prev);
                setShowNotifications(false);
                setShowLanguageMenu(false);
              }}
              className="flex items-center gap-2.5 p-1.5 hover:bg-gray-100 rounded-xl transition-colors pr-2.5"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-md shadow-blue-500/20">
                <span className="text-white font-bold text-sm">
                  {user?.fullName?.charAt(0) || user?.username?.charAt(0) || "U"}
                </span>
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-semibold text-gray-700 leading-tight">
                  {formatUserField(user.fullName || user.username, "User")}
                </p>
                <p className="text-[10px] text-gray-400 capitalize leading-tight">
                  {formatUserField(user.role, "Operator")}
                </p>
              </div>
              <ChevronDown size={14} className="text-gray-400 hidden sm:block" />
            </button>

            {showProfile && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-2xl shadow-2xl shadow-gray-200/50 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="px-4 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
                  <p className="font-semibold text-sm text-gray-800">
                    {formatUserField(user.fullName || user.username, t("header.profileUser", "User"))}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500 capitalize">
                      {formatUserField(user.role, t("header.profileOperator", "Operator"))}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-gray-300" />
                    <span className="text-xs text-emerald-600 flex items-center gap-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                      Active
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    navigate(APP_ROUTES.faq);
                    setShowProfile(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-50 transition-colors border-b border-gray-100"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                    <CircleHelp size={16} />
                  </div>
                  <span className="text-sm font-medium">{t("header.faq", "FAQ & Help")}</span>
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-600">
                    <LogOut size={16} />
                  </div>
                  <span className="text-sm font-medium">{t("header.signOut", "Sign Out")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Search Overlay */}
      {mobileSearchOpen && (
        <div className="fixed inset-0 z-[70] sm:hidden">
          <button
            type="button"
            aria-label={t("common.close", "Close")}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setMobileSearchOpen(false);
              setSearchOpen(false);
            }}
          />
          <div className="absolute top-3 left-3 right-3 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-4 duration-300">
            <div className="px-3 py-3 border-b border-gray-100 flex items-center gap-2">
              <Search size={18} className="text-gray-400 flex-shrink-0" />
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
                className="flex-1 bg-transparent text-sm text-gray-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSearchOpen(false);
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
                aria-label={t("common.close", "Close")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-3 py-2 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-wide uppercase text-gray-500">
                {searchValue.trim()
                  ? t("header.suggestions", "Suggestions")
                  : t("header.recommendedPages", "Recommended Pages")}
              </span>
              <span className="text-[10px] text-gray-400">{suggestions.length} results</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {suggestions.length === 0 ? (
                <div className="px-4 py-8 text-sm text-gray-400 text-center">
                  <Search size={32} className="mx-auto opacity-20 mb-2" />
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
                      className={`w-full text-left px-4 py-3 transition-all duration-150 ${
                        isActive ? "bg-blue-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{item.icon || "📄"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                            {isCurrentPage && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex-shrink-0">
                                Current
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 truncate">{item.description}</p>
                        </div>
                        <ArrowUpRight size={14} className="text-gray-300 flex-shrink-0" />
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