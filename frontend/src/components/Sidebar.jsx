import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Factory,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  QrCode,
  UserCog,
  Wrench,
  Boxes,
  SlidersHorizontal,
  Settings2,
  Activity,
  Package,
  Cpu,
  ScanLine,
  Wifi,
  Clock3,
  Regex,
  Users,
  FileText,
  X,
} from "lucide-react";
import { APP_ROUTES } from "../constants/routes";
import { roleAccessApi } from "../api/services";
import { getUserRole } from "../utils/authStorage";
import { canAccessModule, getRoleAccessSettings, saveRoleAccessSettings } from "../utils/roleAccess";

const Sidebar = ({ onClose }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [masterOpen, setMasterOpen] = useState(true);
  const [roleAccessSettings, setRoleAccessSettings] = useState(() => getRoleAccessSettings());
  const location = useLocation();
  const userRole = getUserRole();

  // Close mobile sidebar when route changes
  useEffect(() => {
    if (onClose) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const topNavigation = useMemo(
    () => [
      { name: "Dashboard", path: APP_ROUTES.dashboard, icon: LayoutDashboard, moduleKey: "dashboard" },
      { name: "Operator View", path: APP_ROUTES.operatorView, icon: UserCog, moduleKey: "operator_view" },
      { name: "I/O Monitor", path: APP_ROUTES.ioMonitor, icon: Activity, moduleKey: "io_monitor" },
      { name: "Scanner Monitor", path: APP_ROUTES.scannerMonitor, icon: Wifi, moduleKey: "scanners" },
      { name: "Part Journey", path: APP_ROUTES.partJourney, icon: Wrench, moduleKey: "part_journey" },
      { name: "Production", path: APP_ROUTES.production, icon: Factory, moduleKey: "production" },
      { name: "Packing", path: APP_ROUTES.packing, icon: Boxes, moduleKey: "packing" },
    ],
    []
  );

  const masterNavigation = useMemo(
    () => [
      { name: "Role Access", path: APP_ROUTES.masterSettings, icon: SlidersHorizontal, moduleKey: "master_settings" },
      { name: "Station Controls", path: APP_ROUTES.stationControls, icon: Settings2, moduleKey: "master_settings" },
      { name: "Machine Manager", path: APP_ROUTES.machines, icon: Package, moduleKey: "machines" },
      { name: "PLC Manager", path: APP_ROUTES.plcConfig, icon: Cpu, moduleKey: "plc_config" },
      { name: "Scanner Manager", path: APP_ROUTES.scanners, icon: ScanLine, moduleKey: "scanners" },
      { name: "Shift Manager", path: APP_ROUTES.shifts, icon: Clock3, moduleKey: "shifts" },
      { name: "QR Manager", path: APP_ROUTES.qrRules, icon: Regex, moduleKey: "qr_rules" },
      { name: "Report Config", path: APP_ROUTES.masterReports, icon: FileText, moduleKey: "master_settings" },
      { name: "Packing Management", path: APP_ROUTES.packingManagement, icon: Boxes, moduleKey: "packing_management" },
      { name: "User Management", path: APP_ROUTES.users, icon: Users, moduleKey: "users" },
    ],
    []
  );

  const visibleTopNavigation = useMemo(
    () => topNavigation.filter((entry) => canAccessModule(userRole, entry.moduleKey, roleAccessSettings)),
    [roleAccessSettings, topNavigation, userRole]
  );

  const visibleMasterNavigation = useMemo(
    () => masterNavigation.filter((entry) => canAccessModule(userRole, entry.moduleKey, roleAccessSettings)),
    [masterNavigation, roleAccessSettings, userRole]
  );

  const isMasterActive = useMemo(
    () => visibleMasterNavigation.some((item) => location.pathname.startsWith(item.path)),
    [location.pathname, visibleMasterNavigation]
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
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);

  const renderNavItem = (item, nested = false) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.path}
        to={item.path}
        title={collapsed ? item.name : undefined}
        className={({ isActive }) =>
          `flex items-center ${collapsed ? "justify-center" : "gap-3"} px-3 py-2.5 rounded-xl transition-all duration-200
           ${nested && !collapsed ? "ml-3" : ""}
           ${isActive
            ? "bg-[#1a3263] text-[#e8e2db] font-semibold border border-transparent shadow-[0_2px_8px_rgba(26,50,99,0.3)]"
            : "text-text-muted hover:bg-bg-hover/60 hover:text-text-main border border-transparent"
          }`
        }
      >
        <Icon size={17} className="flex-shrink-0" />
        {!collapsed && <span className="text-sm truncate">{item.name}</span>}
      </NavLink>
    );
  };

  const sectionLabel = (label) =>
    !collapsed && (
      <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-text-muted/60 select-none">
        {label}
      </p>
    );

  return (
    <aside
      className={`
        ${collapsed ? "w-[72px]" : "w-64"}
        h-screen flex flex-col
        bg-bg-card/80 backdrop-blur-2xl
        border-r border-border/60
        transition-all duration-300 ease-in-out
        overflow-hidden
      `}
    >
      {/* Logo bar */}
      <div className="h-16 flex-shrink-0 flex items-center justify-between px-3 border-b border-border/60">
        {!collapsed ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center border border-primary/20 flex-shrink-0">
              <QrCode className="text-primary" size={20} />
            </div>
            <span className="font-bold text-lg tracking-tight text-text-main">
              Indus<span className="text-primary">Trace</span>
            </span>
          </div>
        ) : (
          <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center mx-auto border border-primary/20">
            <QrCode className="text-primary" size={20} />
          </div>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Mobile close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-bg-hover rounded-lg transition-colors lg:hidden"
              aria-label="Close sidebar"
            >
              <X size={16} />
            </button>
          )}
          {/* Desktop collapse button */}
          <button
            onClick={() => setCollapsed((p) => !p)}
            className="p-1.5 hover:bg-bg-hover rounded-lg transition-colors hidden lg:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </div>

      {/* Navigation (scrollable) */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 pr-1 space-y-0.5 scrollbar-thin">

        {sectionLabel("Main")}
        {visibleTopNavigation.map((item) => renderNavItem(item))}

        {/* Settings group */}
        {visibleMasterNavigation.length > 0 && (
          <>
            {sectionLabel("Settings")}
            <button
              onClick={() => setMasterOpen((p) => !p)}
              className={`w-full flex items-center ${collapsed ? "justify-center" : "justify-between gap-3"} px-3 py-2.5 rounded-xl transition-all border border-transparent
                ${isMasterActive
                  ? "bg-[#1a3263] text-[#e8e2db] shadow-[0_2px_8px_rgba(26,50,99,0.3)]"
                  : "text-text-muted hover:bg-bg-hover/60 hover:text-text-main"
                }`}
            >
              <span className="flex items-center gap-3">
                <SlidersHorizontal size={17} className="flex-shrink-0" />
                {!collapsed && <span className="text-sm font-medium">Configuration</span>}
              </span>
              {!collapsed && (
                <ChevronDown size={14} className={`transition-transform flex-shrink-0 ${masterOpen ? "rotate-180" : ""}`} />
              )}
            </button>

            {!collapsed && masterOpen && (
              <div className="space-y-0.5 mt-0.5">
                {visibleMasterNavigation.map((item) => renderNavItem(item, true))}
              </div>
            )}

            {collapsed && (
              <div className="space-y-0.5 mt-0.5">
                {visibleMasterNavigation.map((item) => renderNavItem(item))}
              </div>
            )}
          </>
        )}
      </nav>

      {/* Version footer */}
      {!collapsed && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-border/60">
          <p className="text-[10px] text-text-muted/60 text-center">IndusTrace v2.0 - Production Ready</p>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
