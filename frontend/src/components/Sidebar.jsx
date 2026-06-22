import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Factory,
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

const RicoIcon = () => (
  <div className="flex flex-col items-center leading-none select-none">
    <span
      style={{
        fontFamily:
          "'Arial Black', 'Impact', 'Franklin Gothic Medium', sans-serif",
        fontWeight: 900,
        fontSize: "40px",
        color: "#1a3a7c",
        lineHeight: 1,
        letterSpacing: "0.05em",
      }}
    >
      R
    </span>
  </div>
);

const Sidebar = ({ onClose }) => {
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [traceOpen, setTraceOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roleAccessSettings, setRoleAccessSettings] = useState(() =>
    getRoleAccessSettings()
  );

  const location = useLocation();
  const userRole = getUserRole();

  useEffect(() => {
    if (onClose) onClose();
  }, [location.pathname]);

  const traceabilityNavigation = useMemo(
    () => [
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
        name: t("pages.production", "Production"),
        path: APP_ROUTES.production,
        icon: Factory,
        moduleKey: "production",
      },
      {
        name: t("pages.reports", "Reports"),
        path: APP_ROUTES.reports,
        icon: BarChart3,
        moduleKey: "reports",
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
      {
        name: t("pages.controlPlan", "Control Plan"),
        path: APP_ROUTES.controlPlan,
        icon: Sheet,
        moduleKey: "control_plan",
        newTab: true,
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
        moduleKey: "master_settings",
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

    return (
      <NavLink
        key={item.path}
        to={item.path}
        end
        target={item.newTab ? "_blank" : undefined}
        rel={item.newTab ? "noopener noreferrer" : undefined}
        title={collapsed ? item.name : undefined}
        className={({ isActive }) =>
          `group flex items-center ${collapsed ? "justify-center px-2" : "gap-3 px-3"} py-2 rounded-xl transition-all duration-200 ${
            nested && !collapsed ? "ml-3" : ""
          } ${
            isActive
              ? "bg-[#1a3263] text-[#e8e2db] font-semibold shadow-md"
              : "text-text-muted hover:bg-bg-hover/60 hover:text-text-main"
          }`
        }
      >
        <Icon size={18} className="flex-shrink-0" />
        {!collapsed && <span className="text-sm truncate">{item.name}</span>}
      </NavLink>
    );
  };

  const renderSectionToggle = (label, Icon, isOpen, onToggle) => (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-2 py-2 rounded-xl transition-all ${
        isOpen ? "bg-bg-hover text-blue-400" : "text-text-muted hover:bg-bg-hover/60"
      }`}
    >
      <span className={`flex items-center ${collapsed ? "justify-center w-full" : "gap-3"}`}>
        <Icon size={18} />
        {!collapsed && <span className="text-sm">{label}</span>}
      </span>
      {!collapsed && (
        <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
      )}
    </button>
  );

  return (
    <aside
      className={`${collapsed ? "w-[60px]" : "w-[240px]"} h-full flex flex-col relative z-50 bg-bg-card/90 backdrop-blur-xl border-r border-border/60 transition-all duration-300 overflow-hidden`}
    >
      <div className="h-14 flex items-center justify-between px-3 border-b border-border/60">
        {!collapsed ? (
          <div className="flex items-center flex-1 min-w-0">
            <img
              src={logo}
              alt="RICO"
              draggable={false}
              style={{
                height: "30px",
                width: "auto",
                objectFit: "contain",
                objectPosition: "left center",
                display: "block",
                userSelect: "none",
              }}
            />
          </div>
        ) : (
          <div className="w-full flex justify-center">
            <RicoIcon />
          </div>
        )}

        {!collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="p-1 rounded-lg hover:bg-bg-hover/60 flex-shrink-0 ml-1"
            title="Collapse sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="absolute top-4 right-[-12px] bg-bg-card border border-border rounded-full p-1 shadow-md"
            title="Expand sidebar"
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {renderSectionToggle(
          t("pages.traceability", "Traceability"),
          Factory,
          traceOpen,
          () => setTraceOpen((prev) => !prev)
        )}

        {(traceOpen || collapsed) && (
          <div className="space-y-0.5">
            {visibleTraceNavigation.map((item) => renderNavItem(item, !collapsed))}

            {visibleSettingsNavigation.length > 0 && (
              <div className="mt-1">
                {renderSectionToggle(
                  t("pages.settings", "Settings"),
                  Settings2,
                  settingsOpen,
                  () => setSettingsOpen((prev) => !prev)
                )}

                {(settingsOpen || collapsed) && (
                  <div className="space-y-0.5 mt-0.5">
                    {visibleSettingsNavigation.map((item) => renderNavItem(item, true))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </nav>

      {!collapsed && (
        <div className="px-3 py-2 border-t border-border/60 flex items-center gap-2">
          <img
            src={logo}
            alt="RICO"
            draggable={false}
            style={{
              height: "13px",
              width: "auto",
              objectFit: "contain",
              opacity: 0.45,
              userSelect: "none",
            }}
          />
          <span className="text-[10px] text-text-muted/60">Traceability v2.0</span>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
