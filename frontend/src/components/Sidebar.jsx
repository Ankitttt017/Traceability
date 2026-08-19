import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  UserCog,
  Wrench,
  Boxes,
  SlidersHorizontal,
  Settings2,
  Activity,
  Cpu,
  ScanLine,
  Wifi,
  Clock3,
  Regex,
  Users,
  FileText,
  Route,
  Zap,
  BarChart3,
  Sheet,
  AlertTriangle,
  Building2,
  GitBranch,
  PackageCheck,
  Sparkles,
  Shield,
  Gem,
  ChevronUp,
  CircleDot,
  Menu,
  Database,
} from "lucide-react";

import { APP_ROUTES } from "../constants/routes";
import { roleAccessApi } from "../api/services";
import { getUserRole } from "../utils/authStorage";
import {
  canAccessModule,
  getRoleAccessSettings,
  saveRoleAccessSettings,
} from "../utils/roleAccess";
import { useLanguage } from "../context/LanguageContext";
import logo from "../assets/images/logo.jpg";

// Enhanced Logo Component
const Logo = ({ collapsed }) => {
  if (collapsed) {
    return (
      <div className="relative">
        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-400 to-blue-400 rounded-full blur-md opacity-40 animate-pulse" />
        <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <span className="text-white font-black text-xl tracking-tight">R</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 group">
      <div className="relative">
        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-400 to-blue-400 rounded-full blur-md opacity-30 group-hover:opacity-50 transition-opacity" />
        <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 group-hover:scale-105 transition-transform">
          <span className="text-white font-black text-2xl tracking-tight">R</span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-lg font-bold bg-gradient-to-r from-indigo-700 to-blue-700 bg-clip-text text-transparent leading-tight">
          RICO
        </span>
        <span className="text-[8px] font-bold text-indigo-400 uppercase tracking-[0.2em] -mt-0.5">
          Traceability
        </span>
      </div>
    </div>
  );
};

const Sidebar = ({ onClose }) => {
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [traceOpen, setTraceOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [roleAccessSettings, setRoleAccessSettings] = useState(() =>
    getRoleAccessSettings()
  );
  const [hoveredItem, setHoveredItem] = useState(null);

  const location = useLocation();
  const userRole = getUserRole();

  useEffect(() => {
    if (onClose) onClose();
  }, [location.pathname]);

  const traceabilityNavigation = useMemo(
    () => [
      {
        name: t("pages.dashboard", "Dashboard"),
        path: APP_ROUTES.dashboard,
        icon: LayoutDashboard,
        moduleKey: "dashboard",
      },
      
     
      {
        name: t("pages.operatorView", "Operator View"),
        path: APP_ROUTES.operatorView,
        icon: UserCog,
        moduleKey: "operator_view",
      },
      {
        name: t("pages.reports", "Reports"),
        path: APP_ROUTES.reports,
        icon: BarChart3,
        moduleKey: "reports",
      },
      {
        name: t("pages.historicalReports", "Historical Reports"),
        path: APP_ROUTES.historicalReports,
        icon: Database,
        moduleKey: "reports",
      },
      {
        name: t("pages.rejectionAnalysis", "Rejection Analysis"),
        path: APP_ROUTES.rejectionAnalysis,
        icon: AlertTriangle,
        moduleKey: "rejection_analysis",
      },
      {
        name: t("pages.packing", "Packing"),
        path: APP_ROUTES.packing,
        icon: Boxes,
        moduleKey: "packing",
      },
      {
        name: t("pages.partJourney", "Part Journey"),
        path: APP_ROUTES.partJourney,
        icon: Wrench,
        moduleKey: "part_journey",
      },
      {
        name: t("pages.ioMonitor", "I/O Monitor"),
        path: APP_ROUTES.ioMonitor,
        icon: Activity,
        moduleKey: "io_monitor",
      },
      {
        name: t("pages.scannerMonitor", "Scanner Monitor"),
        path: APP_ROUTES.scannerMonitor,
        icon: Wifi,
        moduleKey: "scanner_monitor",
      },
      
    ],
    [t]
  );

  const settingsNavigation = useMemo(
    () => [
      {
        name: t("pages.machineManager", "Machine Manager"),
        path: APP_ROUTES.machines,
        icon: Cpu,
        moduleKey: "machines",
      },
      {
        name: t("pages.plcManager", "PLC Manager"),
        path: APP_ROUTES.plcConfig,
        icon: Zap,
        moduleKey: "plc_config",
      },
      {
        name: t("pages.scannerManager", "Scanner Manager"),
        path: APP_ROUTES.scanners,
        icon: ScanLine,
        moduleKey: "scanners",
      },
      {
        name: t("pages.qrManager", "QR Manager"),
        path: APP_ROUTES.qrRules,
        icon: Regex,
        moduleKey: "qr_rules",
      },
      {
        name: t("pages.packingManagement", "Packing Management"),
        path: APP_ROUTES.packingManagement,
        icon: Boxes,
        moduleKey: "packing_management",
      },
      {
        name: t("pages.stationControls", "Station Controls"),
        path: APP_ROUTES.stationControls,
        icon: Settings2,
        moduleKey: "station_control",
      },
      {
        name: t("pages.rejectionConfig", "Rejection Config"),
        path: APP_ROUTES.rejectionConfiguration,
        icon: AlertTriangle,
        moduleKey: "rejection_config",
      },
      {
        name: t("pages.reportConfig", "Report Config"),
        path: APP_ROUTES.masterReports,
        icon: FileText,
        moduleKey: "report_config",
      },
      {
        name: t("pages.shiftManager", "Shift Manager"),
        path: APP_ROUTES.shifts,
        icon: Clock3,
        moduleKey: "shifts",
      },
      {
        name: t("pages.roleAccess", "Role Access"),
        path: APP_ROUTES.masterSettings,
        icon: SlidersHorizontal,
        moduleKey: "master_settings",
      },
      {
        name: t("pages.userManagement", "User Management"),
        path: APP_ROUTES.users,
        icon: Users,
        moduleKey: "users",
      },
    ],
    [t]
  );

  const organizationNavigation = useMemo(
    () => [
      {
        name: "Plant Manager",
        path: APP_ROUTES.plants,
        icon: Building2,
        moduleKey: "plants",
      },
      {
        name: "Line Manager",
        path: APP_ROUTES.lines,
        icon: GitBranch,
        moduleKey: "lines",
      },
      {
        name: "Part Manager",
        path: APP_ROUTES.parts,
        icon: PackageCheck,
        moduleKey: "parts",
      },
      {
        name: t("pages.controlPlan", "Control Plan"),
        path: APP_ROUTES.controlPlan,
        icon: Sheet,
        moduleKey: "control_plan",
        newTab: true,
      },
      {
        name: t("pages.partProcessFlow", "Part Process Flow"),
        path: APP_ROUTES.partProcessFlow,
        icon: Route,
        moduleKey: "part_process_flow",
      },
      {
        name: t("pages.processFlow", "Process Flow"),
        path: APP_ROUTES.processFlow,
        icon: Route,
        moduleKey: "process_flow",
      },
    ],
    []
  );

  const visibleTraceNavigation = useMemo(
    () =>
      traceabilityNavigation.filter((item) =>
        canAccessModule(userRole, item.moduleKey, roleAccessSettings)
      ),
    [roleAccessSettings, traceabilityNavigation, userRole]
  );

  const visibleSettingsNavigation = useMemo(
    () =>
      settingsNavigation.filter((item) =>
        canAccessModule(userRole, item.moduleKey, roleAccessSettings)
      ),
    [roleAccessSettings, settingsNavigation, userRole]
  );

  const visibleOrganizationNavigation = useMemo(
    () =>
      organizationNavigation.filter((item) =>
        canAccessModule(userRole, item.moduleKey, roleAccessSettings)
      ),
    [organizationNavigation, roleAccessSettings, userRole]
  );

  useEffect(() => {
    let cancelled = false;

    roleAccessApi
      .list()
      .then((data) => {
        if (cancelled || !data) return;
        saveRoleAccessSettings(data);
        setRoleAccessSettings(getRoleAccessSettings());
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const renderNavItem = (item, nested = false) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.path;
    const isHovered = hoveredItem === item.path;

    return (
      <NavLink
        key={item.path}
        to={item.path}
        end
        target={item.newTab ? "_blank" : undefined}
        rel={item.newTab ? "noopener noreferrer" : undefined}
        title={collapsed ? item.name : undefined}
        onMouseEnter={() => setHoveredItem(item.path)}
        onMouseLeave={() => setHoveredItem(null)}
        className={({ isActive }) =>
          `group relative flex items-center ${
            collapsed ? "justify-center px-2" : "gap-3 px-4"
          } py-2.5 rounded-xl transition-all duration-300 ${
            nested && !collapsed ? "ml-4" : ""
          } ${
            isActive
              ? "bg-gradient-to-r from-indigo-50 to-blue-50 text-indigo-700 font-semibold border border-indigo-200/50 shadow-sm"
              : "text-gray-500 hover:text-indigo-600 hover:bg-indigo-50/40"
          } ${isHovered && !isActive ? "scale-[1.02]" : ""}`
        }
      >
        {isActive && (
          <>
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-indigo-500 to-blue-500 rounded-r-full shadow-lg shadow-indigo-500/30" />
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-blue-500/5 rounded-xl" />
          </>
        )}
        <Icon 
          size={18} 
          className={`flex-shrink-0 transition-all duration-300 ${
            isActive ? 'text-indigo-600' : isHovered ? 'text-indigo-500 scale-110' : ''
          }`} 
        />
        {!collapsed && (
          <span className="text-sm font-medium truncate relative z-10">{item.name}</span>
        )}
        {isActive && !collapsed && (
          <Sparkles size={12} className="text-indigo-400 ml-auto animate-pulse" />
        )}
        {item.newTab && !collapsed && (
          <span className="text-[8px] font-bold text-indigo-400 bg-indigo-50 px-1.5 py-0.5 rounded ml-auto">
            NEW
          </span>
        )}
      </NavLink>
    );
  };

  const renderSectionToggle = (label, Icon, isOpen, onToggle, badge, color = "indigo") => {
    const colorMap = {
      indigo: "from-indigo-50/80 to-blue-50/80 text-indigo-700 border-indigo-200/50",
      emerald: "from-emerald-50/80 to-teal-50/80 text-emerald-700 border-emerald-200/50",
      amber: "from-amber-50/80 to-orange-50/80 text-amber-700 border-amber-200/50",
      rose: "from-rose-50/80 to-pink-50/80 text-rose-700 border-rose-200/50",
    };
    
    const activeColor = colorMap[color] || colorMap.indigo;

    return (
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-300 ${
          isOpen 
            ? `bg-gradient-to-r ${activeColor} border shadow-sm` 
            : "text-gray-500 hover:text-indigo-600 hover:bg-indigo-50/40"
        }`}
      >
        <span className={`flex items-center ${collapsed ? "justify-center w-full" : "gap-3"}`}>
          <Icon size={18} className={isOpen ? `text-${color}-600` : ""} />
          {!collapsed && <span className="text-sm font-medium">{label}</span>}
          {badge && !collapsed && (
            <span className={`ml-auto text-[8px] font-bold text-${color}-600 bg-${color}-100 px-2 py-0.5 rounded-full`}>
              {badge}
            </span>
          )}
        </span>
        {!collapsed && (
          <ChevronDown 
            size={14} 
            className={`transition-all duration-300 ${isOpen ? "rotate-180 text-indigo-600" : "text-gray-400"}`} 
          />
        )}
      </button>
    );
  };

  return (
    <aside
      className={`${
        collapsed ? "w-[68px]" : "w-[260px]"
      } h-full flex flex-col relative z-50 bg-white/95 backdrop-blur-xl border-r border-gray-200/60 shadow-xl shadow-indigo-100/30 transition-all duration-400 overflow-hidden`}
    >
      {/* Animated gradient border */}
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-indigo-400 via-blue-400 to-purple-400 bg-[length:200%] animate-gradient-x" />

      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200/60 bg-gradient-to-r from-white to-indigo-50/30">
        <Logo collapsed={collapsed} />

        {!collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-lg hover:bg-indigo-100 text-gray-400 hover:text-indigo-600 transition-all duration-200 flex-shrink-0 ml-1 group"
            title="Collapse sidebar"
          >
            <ChevronLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="absolute top-4 right-[-12px] bg-white border-2 border-indigo-200 rounded-full p-1 shadow-lg hover:shadow-indigo-200/50 transition-all duration-200 hover:border-indigo-400 hover:scale-110 z-20"
            title="Expand sidebar"
          >
            <ChevronRight size={14} className="text-indigo-600" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1.5 scrollbar-thin scrollbar-thumb-indigo-200 scrollbar-track-transparent hover:scrollbar-thumb-indigo-300">
        {/* Traceability Section */}
        {renderSectionToggle(
          t("pages.traceability", "Traceability"),
          Route,
          traceOpen,
          () => setTraceOpen((prev) => !prev),
          visibleTraceNavigation.length,
          "indigo"
        )}

        {(traceOpen || collapsed) && (
          <div className="space-y-0.5 ml-1 animate-slideDown">
            {visibleTraceNavigation.map((item) => renderNavItem(item, !collapsed))}

            {visibleSettingsNavigation.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-gray-200/50 pt-3">
                {/* Organization Section */}
                {visibleOrganizationNavigation.length > 0 && (
                  <>
                    {renderSectionToggle(
                      "Organization",
                      Building2,
                      organizationOpen,
                      () => setOrganizationOpen((prev) => !prev),
                      visibleOrganizationNavigation.length,
                      "emerald"
                    )}
                    {(organizationOpen || collapsed) && (
                      <div className="space-y-0.5 ml-1 animate-slideDown">
                        {visibleOrganizationNavigation.map((item) => renderNavItem(item, true))}
                      </div>
                    )}
                  </>
                )}
                
                {/* Settings Section */}
                {renderSectionToggle(
                  t("pages.settings", "Settings"),
                  Settings2,
                  settingsOpen,
                  () => setSettingsOpen((prev) => !prev),
                  visibleSettingsNavigation.length,
                  "amber"
                )}

                {(settingsOpen || collapsed) && (
                  <div className="space-y-0.5 ml-1 animate-slideDown">
                    {visibleSettingsNavigation.map((item) => renderNavItem(item, true))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Footer */}
      {!collapsed ? (
        <div className="px-4 py-3 border-t border-gray-200/60 bg-gradient-to-r from-indigo-50/30 to-blue-50/30">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-100 to-blue-100 flex items-center justify-center border border-indigo-200/50 shadow-sm">
              <Shield size={15} className="text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-gray-700 truncate">RICO Traceability</p>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-gray-400 font-medium tracking-wider">v2.0</span>
                <span className="text-[8px] text-indigo-400">•</span>
                <span className="text-[8px] text-indigo-400 font-medium">Enterprise</span>
              </div>
            </div>
            <Gem size={12} className="text-indigo-300 animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="px-3 py-3 border-t border-gray-200/60 flex justify-center">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-100 to-blue-100 flex items-center justify-center border border-indigo-200/50">
            <Shield size={14} className="text-indigo-600" />
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;