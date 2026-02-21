import { useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Factory,
  Barcode,
  Package,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  QrCode,
  UserCog,
  Wrench,
  Regex,
  ScanLine,
  Boxes,
  Clock3,
} from "lucide-react";
import { clearAuthSession } from "../utils/authStorage";
import { APP_ROUTES } from "../constants/routes";

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const navigation = useMemo(
    () => [
      { name: "Dashboard", path: APP_ROUTES.dashboard, icon: LayoutDashboard },
      { name: "Production", path: APP_ROUTES.production, icon: Factory },
      { name: "Traceability", path: APP_ROUTES.traceability, icon: Barcode },
      { name: "Machines", path: APP_ROUTES.machines, icon: Package },
      { name: "Scanners", path: APP_ROUTES.scanners, icon: ScanLine },
      { name: "Shifts", path: APP_ROUTES.shifts, icon: Clock3 },
      { name: "QR Rules", path: APP_ROUTES.qrRules, icon: Regex },
      { name: "Users", path: APP_ROUTES.users, icon: Users },
      { name: "Part Journey", path: APP_ROUTES.partJourney, icon: Wrench },
      { name: "Operator View", path: APP_ROUTES.operatorView, icon: UserCog },
      { name: "Packing", path: APP_ROUTES.packing, icon: Boxes },
    ],
    []
  );

  const formatUserField = (value, fallback) => {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    return fallback;
  };

  const handleLogout = () => {
    clearAuthSession();
    navigate(APP_ROUTES.login, { replace: true });
  };

  return (
    <aside
      className={`${
        collapsed ? "w-20" : "w-64"
      } bg-bg-card/50 backdrop-blur-xl border-r border-border/50 flex flex-col transition-all duration-300`}
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

      <nav className="flex-1 py-6">
        <div className="space-y-1 px-3">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center ${collapsed ? "justify-center" : "space-x-3"} px-3 py-3 rounded-lg transition-all ${
                    isActive
                      ? "bg-gradient-to-r from-primary/20 to-transparent text-primary border-l-4 border-primary"
                      : "text-text-muted hover:bg-bg-card/80 hover:text-text-main"
                  }`
                }
              >
                <Icon size={20} />
                {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="p-4 border-t border-border/50">
        <div className={`flex items-center ${collapsed ? "justify-center" : "space-x-3"} mb-4`}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
            <UserCog size={18} className="text-bg-dark" />
          </div>
          {!collapsed && (
            <div className="text-sm">
              <p className="font-medium text-text-main">{formatUserField(user.username, "User")}</p>
              <p className="text-text-muted text-xs">{formatUserField(user.role, "Operator")}</p>
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className={`w-full flex items-center ${collapsed ? "justify-center" : "space-x-3"} px-3 py-2 text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors`}
        >
          <LogOut size={18} />
          {!collapsed && <span className="text-sm">Logout</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
