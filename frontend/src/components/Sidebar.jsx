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
  Package,
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
} from "lucide-react";

import { APP_ROUTES } from "../constants/routes";
import { roleAccessApi } from "../api/services";
import { getUserRole } from "../utils/authStorage";
import {
  canAccessModule,
  getRoleAccessSettings,
  saveRoleAccessSettings,
} from "../utils/roleAccess";
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

// ─────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────
const Sidebar = ({ onClose }) => {
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

  // ── TRACEABILITY OPERATIONAL PAGES ──────────
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
        name: "Production",
        path: APP_ROUTES.production,
        icon: Factory,
        moduleKey: "production",
      },
      {
        name: "Reports",
        path: APP_ROUTES.reports,
        icon: BarChart3,
        moduleKey: "production",
      },
      {
        name: "Packing",
        path: APP_ROUTES.packing,
        icon: Boxes,
        moduleKey: "packing",
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
    ],
    []
  );

  // ── SETTINGS & MASTER PAGES (SEQUENTIAL) ─────
  const settingsNavigation = useMemo(
    () => [

      {
        name: "Machine Manager",
        path: APP_ROUTES.machines,
        icon: Cpu,
        moduleKey: "machines",
      },
      {
        name: "PLC Manager",
        path: APP_ROUTES.plcConfig,
        icon: Zap,
        moduleKey: "plc_config",
      },
      {
        name: "Scanner Manager",
        path: APP_ROUTES.scanners,
        icon: ScanLine,
        moduleKey: "scanners",
      },
      {
        name: "QR Manager",
        path: APP_ROUTES.qrRules,
        icon: Regex,
        moduleKey: "qr_rules",
      },
      {
        name: "Packing Management",
        path: APP_ROUTES.packingManagement,
        icon: Boxes,
        moduleKey: "packing_management",
      },
     
      {
        name: "Station Controls",
        path: APP_ROUTES.stationControls,
        icon: Settings2,
        moduleKey: "master_settings",
      },
      {
        name: "Report Config",
        path: APP_ROUTES.masterReports,
        icon: FileText,
        moduleKey: "master_settings",
      },
       {
        name: "Shift Manager",
        path: APP_ROUTES.shifts,
        icon: Clock3,
        moduleKey: "shifts",
      },
      {
        name: "Role Access",
        path: APP_ROUTES.masterSettings,
        icon: SlidersHorizontal,
        moduleKey: "master_settings",
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

  // ── ROLE FILTER ───────────────────────────
  const visibleTraceNavigation = useMemo(
    () =>
      traceabilityNavigation.filter((item) =>
        canAccessModule(userRole, item.moduleKey, roleAccessSettings)
      ),
    [traceabilityNavigation, roleAccessSettings, userRole]
  );

  const visibleSettingsNavigation = useMemo(
    () =>
      settingsNavigation.filter((item) =>
        canAccessModule(userRole, item.moduleKey, roleAccessSettings)
      ),
    [settingsNavigation, roleAccessSettings, userRole]
  );

  // ── FETCH ROLE ACCESS ─────────────────────
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

  // ── NAV ITEM ──────────────────────────────
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

  // ── SECTION TOGGLE BUTTON ─────────────────
  const renderSectionToggle = (label, icon, isOpen, onToggle) => {
    const Icon = icon;
    return (
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-2 py-2 rounded-xl transition-all
        ${
          isOpen
            ? "bg-bg-hover text-blue-400"
            : "text-text-muted hover:bg-bg-hover/60"
        }`}
      >
        <span
          className={`flex items-center ${
            collapsed ? "justify-center w-full" : "gap-3"
          }`}
        >
          <Icon size={18} />
          {!collapsed && <span className="text-sm">{label}</span>}
        </span>
        {!collapsed && (
          <ChevronDown
            size={14}
            className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        )}
      </button>
    );
  };

  // ─────────────────────────────────────────
  return (
    <aside
      className={`
        ${collapsed ? "w-[60px]" : "w-[240px]"}
        h-full flex flex-col
        relative z-50
        bg-bg-card/90 backdrop-blur-xl
        border-r border-border/60
        transition-all duration-300
        overflow-hidden
      `}
    >
      {/* ── HEADER ── */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-border/60">

        {!collapsed ? (
          /* EXPANDED — real logo image, height-constrained, left-aligned */
          <div className="flex items-center flex-1 min-w-0">
            <img
              src={logo}
              alt="RICO"
              draggable={false}
              style={{
                height: "30px",       /* fits comfortably in the 56px header */
                width: "auto",
                objectFit: "contain",
                objectPosition: "left center",
                display: "block",
                userSelect: "none",
              }}
            />
          </div>
        ) : (
          /* COLLAPSED — R lettermark with red bar */
          <div className="w-full flex justify-center">
            <RicoIcon />
          </div>
        )}

        {/* Collapse / expand button */}
        {!collapsed ? (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 rounded-lg hover:bg-bg-hover/60 flex-shrink-0 ml-1"
            title="Collapse sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        ) : (
          <button
            onClick={() => setCollapsed(false)}
            className="absolute top-4 right-[-12px] bg-bg-card border border-border rounded-full p-1 shadow-md"
            title="Expand sidebar"
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* ── NAVIGATION ── */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {/* Traceability */}
        {renderSectionToggle(
          "Traceability",
          Factory,
          traceOpen,
          () => setTraceOpen((p) => !p)
        )}
        {(traceOpen || collapsed) && (
          <div className="space-y-0.5">
            {visibleTraceNavigation.map((item) =>
              renderNavItem(item, !collapsed)
            )}
            
            {/* Nested Settings Dropdown inside Traceability */}
            {visibleSettingsNavigation.length > 0 && (
              <div className="mt-1">
                {renderSectionToggle(
                  "Settings",
                  Settings2,
                  settingsOpen,
                  () => setSettingsOpen((p) => !p)
                )}
                {(settingsOpen || collapsed) && (
                  <div className="space-y-0.5 mt-0.5">
                    {visibleSettingsNavigation.map((item) =>
                      renderNavItem(item, true)
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* ── FOOTER ── */}
      {!collapsed && (
        <div className="px-3 py-2 border-t border-border/60 flex items-center gap-2">
          {/* Faded logo repeat */}
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
          <span className="text-[10px] text-text-muted/60">
            Traceability v2.0
          </span>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
