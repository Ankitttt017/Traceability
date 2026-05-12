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
  Route,
} from "lucide-react";

import { APP_ROUTES } from "../constants/routes";
import { roleAccessApi } from "../api/services";
import { getUserRole } from "../utils/authStorage";
import {
  canAccessModule,
  getRoleAccessSettings,
  saveRoleAccessSettings,
} from "../utils/roleAccess";

const Sidebar = ({ onClose }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [traceOpen, setTraceOpen] = useState(true);
  const [orgOpen, setOrgOpen] = useState(false);

  const [roleAccessSettings, setRoleAccessSettings] = useState(() =>
    getRoleAccessSettings()
  );

  const location = useLocation();
  const userRole = getUserRole();

  // Close mobile sidebar on route change
  useEffect(() => {
    if (onClose) onClose();
  }, [location.pathname]);

  // ===============================
  // TRACEABILITY
  // ===============================
  const traceabilityNavigation = useMemo(
    () => [
      {
        name: "Dashboard",
        path: APP_ROUTES.dashboard,
        icon: LayoutDashboard,
        moduleKey: "dashboard",
      },
      {
        name: "Operator View",
        path: APP_ROUTES.operatorView,
        icon: UserCog,
        moduleKey: "operator_view",
      },
      {
        name: "I/O Monitor",
        path: APP_ROUTES.ioMonitor,
        icon: Activity,
        moduleKey: "io_monitor",
      },
      {
        name: "Scanner Monitor",
        path: APP_ROUTES.scannerMonitor,
        icon: Wifi,
        moduleKey: "scanners",
      },
      {
        name: "Part Journey",
        path: APP_ROUTES.partJourney,
        icon: Wrench,
        moduleKey: "part_journey",
      },
      {
        name: "Process Flow",
        path: APP_ROUTES.processFlow,
        icon: Route,
        moduleKey: "process_flow",
      },
      {
        name: "Production",
        path: APP_ROUTES.production,
        icon: Factory,
        moduleKey: "production",
      },
      {
        name: "Packing",
        path: APP_ROUTES.packing,
        icon: Boxes,
        moduleKey: "packing",
      },

      {
        name: "Role Access",
        path: APP_ROUTES.masterSettings,
        icon: SlidersHorizontal,
        moduleKey: "master_settings",
      },
      {
        name: "Station Controls",
        path: APP_ROUTES.stationControls,
        icon: Settings2,
        moduleKey: "master_settings",
      },
      {
        name: "Machine Manager",
        path: APP_ROUTES.machines,
        icon: Cpu,
        moduleKey: "machines",
      },

      {
        name: "PLC Manager",
        path: APP_ROUTES.plcConfig,
        icon: Cpu,
        moduleKey: "plc_config",
      },
      {
        name: "Scanner Manager",
        path: APP_ROUTES.scanners,
        icon: ScanLine,
        moduleKey: "scanners",
      },
      {
        name: "Shift Manager",
        path: APP_ROUTES.shifts,
        icon: Clock3,
        moduleKey: "shifts",
      },
      {
        name: "QR Manager",
        path: APP_ROUTES.qrRules,
        icon: Regex,
        moduleKey: "qr_rules",
      },
      {
        name: "Report Config",
        path: APP_ROUTES.masterReports,
        icon: FileText,
        moduleKey: "master_settings",
      },
      {
        name: "Packing Management",
        path: APP_ROUTES.packingManagement,
        icon: Boxes,
        moduleKey: "packing_management",
      },
      {
        name: "User Management",
        path: APP_ROUTES.users,
        icon: Users,
        moduleKey: "users",
      },
    ],
    []
  );

  // ===============================
  // ORGANIZATION
  // ===============================
  const organizationNavigation = useMemo(
    () => [
      {
        name: "Part Master",
        path: APP_ROUTES.parts,
        icon: Package,
        moduleKey: "parts",
      },
      {
        name: "Machine Master",
        path: APP_ROUTES.machineMaster,
        icon: Cpu,
        moduleKey: "machines",
      },
      {
        name: "Operation Master",
        path: APP_ROUTES.operations,
        icon: Wrench,
        moduleKey: "operations",
      },
      {
        name: "Line Master",
        path: APP_ROUTES.lines,
        icon: Activity,
        moduleKey: "lines",
      },
      {
        name: "Plant Master",
        path: APP_ROUTES.plants,
        icon: Factory,
        moduleKey: "plants",
      },
      {
        name: "Division Master",
        path: APP_ROUTES.divisions,
        icon: Boxes,
        moduleKey: "divisions",
      },
      {
        name: "Die Master",
        path: APP_ROUTES.dies,
        icon: Settings2,
        moduleKey: "dies",
      },
    ],
    []
  );

  // ===============================
  // ROLE FILTER
  // ===============================
  const visibleTraceNavigation = useMemo(
    () =>
      traceabilityNavigation.filter((item) =>
        canAccessModule(userRole, item.moduleKey, roleAccessSettings)
      ),
    [traceabilityNavigation, roleAccessSettings, userRole]
  );

  const visibleOrgNavigation = useMemo(
    () =>
      organizationNavigation.filter((item) =>
        canAccessModule(userRole, item.moduleKey, roleAccessSettings)
      ),
    [organizationNavigation, roleAccessSettings, userRole]
  );

  // ===============================
  // FETCH ROLE ACCESS
  // ===============================
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

  // ===============================
  // NAV ITEM
  // ===============================
  const renderNavItem = (item, nested = false) => {
    const Icon = item.icon;

    return (
      <NavLink
        key={item.path}
        to={item.path}
        end
        title={collapsed ? item.name : undefined}
        className={({ isActive }) =>
          `group flex items-center
          ${collapsed ? "justify-center px-2" : "gap-3 px-3"}
          py-2 rounded-xl transition-all duration-200
          ${nested && !collapsed ? "ml-3" : ""}
          
          ${
            isActive
              ? "bg-[#1a3263] text-[#e8e2db] font-semibold shadow-md"
              : "text-text-muted hover:bg-bg-hover/60 hover:text-text-main"
          }`
        }
      >
        <Icon size={18} className="flex-shrink-0" />

        {!collapsed && (
          <span className="text-sm truncate">{item.name}</span>
        )}
      </NavLink>
    );
  };

  const sectionLabel = (label) =>
    !collapsed && (
      <p className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted/60">
        {label}
      </p>
    );

  return (
    <aside
      className={`
        ${collapsed ? "w-[60px]" : "w-[240px]"}
        h-screen flex flex-col
        fixed md:relative z-50
        bg-bg-card/90 backdrop-blur-xl
        border-r border-border/60
        transition-all duration-300
        overflow-hidden
      `}
    >
      {/* HEADER */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-border/60">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <QrCode className="text-primary" size={18} />
            </div>

            <span className="font-bold text-base text-text-main">
              Indus<span className="text-primary">Trace</span>
            </span>
          </div>
        ) : (
          <div className="w-full flex justify-center">
            <QrCode className="text-primary" size={20} />
          </div>
        )}

        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 rounded-lg hover:bg-bg-hover/60"
          >
            <ChevronLeft size={16} />
          </button>
        )}

        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="absolute top-4 right-[-12px] bg-bg-card border border-border rounded-full p-1 shadow-md"
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* NAVIGATION */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {/* ORGANIZATION */}
    

        <button
          onClick={() => setOrgOpen((p) => !p)}
          className={`w-full flex items-center justify-between px-2 py-2 rounded-xl transition-all
          ${
            orgOpen
              ? "bg-bg-hover text-primary"
              : "text-text-muted hover:bg-bg-hover/60"
          }`}
        >
          <span
            className={`flex items-center ${
              collapsed ? "justify-center w-full" : "gap-3"
            }`}
          >
            <SlidersHorizontal size={18} />

            {!collapsed && (
              <span className="text-sm">Organization</span>
            )}
          </span>

          {!collapsed && (
            <ChevronDown
              size={14}
              className={`transition-transform ${
                orgOpen ? "rotate-180" : ""
              }`}
            />
          )}
        </button>

        {(orgOpen || collapsed) && (
          <div className="space-y-0.5">
            {visibleOrgNavigation.map((item) =>
              renderNavItem(item, !collapsed)
            )}
          </div>
        )}

        {/* TRACEABILITY */}
      

        <button
          onClick={() => setTraceOpen((p) => !p)}
          className={`w-full flex items-center justify-between px-2 py-2 rounded-xl transition-all
          ${
            traceOpen
              ? "bg-bg-hover text-primary"
              : "text-text-muted hover:bg-bg-hover/60"
          }`}
        >
          <span
            className={`flex items-center ${
              collapsed ? "justify-center w-full" : "gap-3"
            }`}
          >
            <Factory size={18} />

            {!collapsed && (
              <span className="text-sm">Traceability</span>
            )}
          </span>

          {!collapsed && (
            <ChevronDown
              size={14}
              className={`transition-transform ${
                traceOpen ? "rotate-180" : ""
              }`}
            />
          )}
        </button>

        {(traceOpen || collapsed) && (
          <div className="space-y-0.5">
            {visibleTraceNavigation.map((item) =>
              renderNavItem(item, !collapsed)
            )}
          </div>
        )}
      </nav>

      {/* FOOTER */}
      {!collapsed && (
        <div className="px-2 py-2 border-t border-border/60 text-center text-[10px] text-text-muted/60">
          IndusTrace v2.0
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
