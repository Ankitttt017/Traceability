import { useMemo, useState } from "react";
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
  Activity,
  Package,
  Cpu,
  ScanLine,
  Clock3,
  Regex,
  Users,
} from "lucide-react";
import { APP_ROUTES } from "../constants/routes";

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [masterOpen, setMasterOpen] = useState(true);
  const location = useLocation();

  const topNavigation = useMemo(
    () => [
      { name: "Dashboard", path: APP_ROUTES.dashboard, icon: LayoutDashboard },
      { name: "Production", path: APP_ROUTES.production, icon: Factory },
      { name: "I/O Monitor", path: APP_ROUTES.ioMonitor, icon: Activity },
      { name: "Part Journey", path: APP_ROUTES.partJourney, icon: Wrench },
      { name: "Operator View", path: APP_ROUTES.operatorView, icon: UserCog },
      { name: "Packing", path: APP_ROUTES.packing, icon: Boxes },
    ],
    []
  );

  const masterNavigation = useMemo(
    () => [
      { name: "Master Settings", path: APP_ROUTES.masterSettings, icon: SlidersHorizontal },
      { name: "Machines", path: APP_ROUTES.machines, icon: Package },
      { name: "PLC Config", path: APP_ROUTES.plcConfig, icon: Cpu },
      { name: "Scanners", path: APP_ROUTES.scanners, icon: ScanLine },
      { name: "Shifts", path: APP_ROUTES.shifts, icon: Clock3 },
      { name: "QR Rules", path: APP_ROUTES.qrRules, icon: Regex },
      { name: "Users", path: APP_ROUTES.users, icon: Users },
    ],
    []
  );

  const isMasterActive = useMemo(
    () => masterNavigation.some((item) => location.pathname.startsWith(item.path)),
    [location.pathname, masterNavigation]
  );

  const renderNavItem = (item, nested = false) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.path}
        to={item.path}
        className={({ isActive }) =>
          `flex items-center ${collapsed ? "justify-center" : "space-x-3"} px-3 py-3 rounded-lg transition-all ${
            nested && !collapsed ? "ml-3 mr-1" : ""
          } ${
            isActive
              ? "bg-gradient-to-r from-primary/20 to-transparent text-primary border-l-4 border-primary"
              : "text-text-muted hover:bg-bg-card/80 hover:text-text-main"
          }`
        }
      >
        <Icon size={18} />
        {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
      </NavLink>
    );
  };

  return (
    <aside
      className={`${
        collapsed ? "w-20" : "w-64"
      } bg-bg-card/50 backdrop-blur-xl border-r border-border/50 flex flex-col overflow-hidden transition-all duration-300`}
    >
      <div className="h-16 flex items-center justify-between px-4 border-b border-border/50">
        {!collapsed && (
          <div className="flex items-center space-x-2">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center border border-primary/20">
              <QrCode className="text-primary" size={24} />
            </div>
            <span className="font-bold text-xl tracking-tight text-text-main font-outfit">
              Indus<span className="text-primary">Trace</span>
            </span>
          </div>
        )}
        {collapsed && (
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mx-auto border border-primary/20">
            <QrCode className="text-primary" size={24} />
          </div>
        )}
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="p-1 hover:bg-bg-dark rounded-lg transition-colors"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto py-6">
        <div className="space-y-1 px-3">
          {topNavigation.map((item) => renderNavItem(item))}

          <div className="pt-2">
            <button
              onClick={() => setMasterOpen((prev) => !prev)}
              className={`w-full flex items-center ${
                collapsed ? "justify-center" : "justify-between"
              } px-3 py-3 rounded-lg transition-all ${
                isMasterActive
                  ? "bg-gradient-to-r from-primary/20 to-transparent text-primary border-l-4 border-primary"
                  : "text-text-muted hover:bg-bg-card/80 hover:text-text-main"
              }`}
            >
              <span className={`flex items-center ${collapsed ? "" : "gap-3"}`}>
                <SlidersHorizontal size={18} />
                {!collapsed && <span className="text-sm font-medium">Master</span>}
              </span>
              {!collapsed ? (
                <ChevronDown size={16} className={`transition-transform ${masterOpen ? "rotate-180" : ""}`} />
              ) : null}
            </button>

            {!collapsed && masterOpen && (
              <div className="mt-1 space-y-1">
                {masterNavigation.map((item) => renderNavItem(item, true))}
              </div>
            )}
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar;
