import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertCircle,
  Check,
  CheckCircle,
  Eye,
  EyeOff,
  HardDrive,
  Lock,
  Monitor,
  Save,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
  Crown,
  Award,
  Zap,
  Target,
  Briefcase,
  Building2,
  Layout,
  Settings,
  Database,
  FileText,
  BarChart3,
  Clock,
  Activity,
  Shield,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  Star,
  Gem,
} from "lucide-react";
import { roleAccessApi } from "../api/services";
import {
  ACCESS_LEVEL_OPTIONS,
  MODULE_ACCESS_META,
  ROLE_KEYS,
  USER_ROLE_OPTIONS,
  canEditModule,
  formatAccessLevel,
  getRoleAccessSettings,
  normalizeRoleAccessSettings,
  saveRoleAccessSettings,
} from "../utils/roleAccess";

const ACCESS_LEVEL_COLORS = {
  HIDDEN: { 
    bg: "bg-rose-50", 
    text: "text-rose-600", 
    border: "border-rose-200", 
    badge: "Hidden", 
    icon: <EyeOff size={12} />,
    hover: "hover:bg-rose-100",
    glow: "shadow-rose-100"
  },
  VIEW: { 
    bg: "bg-amber-50", 
    text: "text-amber-600", 
    border: "border-amber-200", 
    badge: "View", 
    icon: <Eye size={12} />,
    hover: "hover:bg-amber-100",
    glow: "shadow-amber-100"
  },
  VIEW_EDIT: { 
    bg: "bg-teal-50", 
    text: "text-teal-600", 
    border: "border-teal-200", 
    badge: "View/Edit", 
    icon: <CheckCircle size={12} />,
    hover: "hover:bg-teal-100",
    glow: "shadow-teal-100"
  },
  VIEW_CONTROL: { 
    bg: "bg-indigo-50", 
    text: "text-indigo-600", 
    border: "border-indigo-200", 
    badge: "Control", 
    icon: <ShieldCheck size={12} />,
    hover: "hover:bg-indigo-100",
    glow: "shadow-indigo-100"
  },
};

const ROLE_META = Object.fromEntries(
  USER_ROLE_OPTIONS.map((role) => {
    const admin = role.value.includes("Admin");
    const manager = role.value.includes("Manager");
    const Icon = admin ? Crown : manager ? Briefcase : role.value === "Maintenance" ? Wrench : role.value === "Operator" ? Monitor : role.value === "Viewer" ? UserRound : HardDrive;
    const color = admin ? "text-rose-600" : manager ? "text-amber-600" : role.value === "Operator" ? "text-indigo-600" : role.value === "Viewer" ? "text-gray-500" : "text-teal-600";
    const bgColor = admin ? "bg-rose-50" : manager ? "bg-amber-50" : role.value === "Operator" ? "bg-indigo-50" : "bg-gray-50";
    return [role.key, { ...role, icon: <Icon size={14} />, color, bgColor }];
  })
);

function checksFromAccess(level) {
  return {
    view: level !== "HIDDEN",
    edit: level === "VIEW_EDIT" || level === "VIEW_CONTROL",
    control: level === "VIEW_CONTROL",
  };
}

function accessFromChecks(checks) {
  if (checks.control) return "VIEW_CONTROL";
  if (checks.edit) return "VIEW_EDIT";
  if (checks.view) return "VIEW";
  return "HIDDEN";
}

const RoleAccess = () => {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);
  const viewerRoleAccess = useMemo(() => getRoleAccessSettings(), []);

  const [roleAccessSettings, setRoleAccessSettings] = useState(() => getRoleAccessSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedModule, setExpandedModule] = useState(null);

  const normalizedRoleAccess = useMemo(
    () => normalizeRoleAccessSettings(roleAccessSettings),
    [roleAccessSettings]
  );
  const canEditPermissions = useMemo(
    () => canEditModule(user.role, "master_settings", viewerRoleAccess),
    [user.role, viewerRoleAccess]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const ra = await roleAccessApi.list().catch(() => null);
      if (ra) setRoleAccessSettings(normalizeRoleAccessSettings(ra));
    } catch (error) {
      console.error(error);
      toast.error("Unable to load role access settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setAccessLevel = (moduleKey, roleKey, level) => {
    setRoleAccessSettings((prev) => ({
      ...prev,
      [moduleKey]: {
        ...(prev[moduleKey] || {}),
        [roleKey]: level,
      },
    }));
  };

  const toggleAccessCheck = (moduleKey, roleKey, checkKey) => {
    const current = normalizedRoleAccess[moduleKey]?.[roleKey] || "HIDDEN";
    const checks = checksFromAccess(current);
    const nextChecks = { ...checks, [checkKey]: !checks[checkKey] };

    if (checkKey === "control" && nextChecks.control) {
      nextChecks.view = true;
      nextChecks.edit = true;
    }
    if (checkKey === "edit" && nextChecks.edit) {
      nextChecks.view = true;
    }
    if (checkKey === "view" && !nextChecks.view) {
      nextChecks.edit = false;
      nextChecks.control = false;
    }
    if (checkKey === "edit" && !nextChecks.edit) {
      nextChecks.control = false;
    }

    setAccessLevel(moduleKey, roleKey, accessFromChecks(nextChecks));
  };

  const applyRolePreset = (roleKey, level) => {
    setRoleAccessSettings((prev) => {
      const next = normalizeRoleAccessSettings(prev);
      MODULE_ACCESS_META.forEach((module) => {
        next[module.key] = { ...(next[module.key] || {}), [roleKey]: level };
      });
      return next;
    });
  };

  const saveSettings = async () => {
    if (!canEditPermissions) {
      toast.error("You do not have permission to modify role permissions.");
      return;
    }
    setSaving(true);
    try {
      const normalized = normalizeRoleAccessSettings(roleAccessSettings);
      const response = await roleAccessApi.save(normalized);
      const saved = normalizeRoleAccessSettings(response?.settings || normalized);
      setRoleAccessSettings(saved);
      saveRoleAccessSettings(saved);
      toast.success("Role access matrix saved successfully");
    } catch (error) {
      toast.error(error.response?.data?.error || "Unable to save role configuration.");
    } finally {
      setSaving(false);
    }
  };

  const getModuleIcon = (moduleKey) => {
    const icons = {
      users: <Users size={16} />,
      master_settings: <Settings size={16} />,
      plants: <Building2 size={16} />,
      dashboard: <Layout size={16} />,
      reports: <BarChart3 size={16} />,
      audit: <Activity size={16} />,
      documents: <FileText size={16} />,
      database: <Database size={16} />,
    };
    return icons[moduleKey] || <HardDrive size={16} />;
  };

  const getModuleGradient = (moduleKey) => {
    const gradients = {
      users: "from-indigo-100 to-blue-100",
      master_settings: "from-purple-100 to-pink-100",
      plants: "from-emerald-100 to-teal-100",
      dashboard: "from-amber-100 to-orange-100",
      reports: "from-rose-100 to-red-100",
      audit: "from-cyan-100 to-sky-100",
      documents: "from-violet-100 to-purple-100",
      database: "from-gray-100 to-slate-100",
    };
    return gradients[moduleKey] || "from-blue-100 to-indigo-100";
  };

  const stats = useMemo(() => {
    let control = 0;
    let edit = 0;
    let view = 0;
    let hidden = 0;
    ROLE_KEYS.forEach((roleKey) => {
      MODULE_ACCESS_META.forEach((module) => {
        const level = normalizedRoleAccess[module.key]?.[roleKey] || "HIDDEN";
        if (level === "VIEW_CONTROL") control++;
        else if (level === "VIEW_EDIT") edit++;
        else if (level === "VIEW") view++;
        else hidden++;
      });
    });
    return { modules: MODULE_ACCESS_META.length, roles: ROLE_KEYS.length, control, edit, view, hidden };
  }, [normalizedRoleAccess]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 p-6 space-y-6" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {/* Header with Soft Blue Theme */}
      <div className="relative overflow-hidden rounded-2xl bg-white/80 backdrop-blur-sm border border-indigo-100 shadow-xl shadow-indigo-100/30">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-400 via-blue-400 to-purple-400" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
        
        <div className="relative px-8 py-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-100 to-blue-100 border border-indigo-200 shadow-lg shadow-indigo-100/50">
              <ShieldCheck size={22} className="text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 bg-clip-text text-transparent">
                Role Access Control
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">Configure granular permissions for each role and module</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadData} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-indigo-600 bg-white hover:bg-indigo-50 rounded-lg border border-gray-200 hover:border-indigo-200 transition-all duration-200 flex items-center gap-2 shadow-sm hover:shadow-md">
              <RefreshCw size={13} className="group-hover:rotate-180 transition-transform" />
              Refresh
            </button>
            <button 
              onClick={saveSettings} 
              disabled={!canEditPermissions || saving} 
              className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 rounded-lg shadow-lg shadow-indigo-500/30 transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? "Saving..." : "Save Permissions"}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards - Soft Blue Theme */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          ["Modules", stats.modules, HardDrive, "text-indigo-600", "from-indigo-50 to-blue-50 border-indigo-200"],
          ["Roles", stats.roles, Users, "text-gray-700", "from-gray-50 to-slate-50 border-gray-200"],
          ["Control", stats.control, ShieldCheck, "text-indigo-600", "from-indigo-50 to-blue-50 border-indigo-200"],
          ["View/Edit", stats.edit, CheckCircle, "text-teal-600", "from-teal-50 to-emerald-50 border-teal-200"],
          ["Hidden", stats.hidden, Lock, "text-rose-600", "from-rose-50 to-red-50 border-rose-200"],
        ].map(([label, value, Icon, color, bg]) => (
          <div key={label} className={`group relative p-4 rounded-xl bg-gradient-to-br ${bg} border shadow-sm hover:shadow-lg transition-all duration-300 hover:scale-[1.02]`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
                <p className={`text-2xl font-black ${color}`}>{value}</p>
              </div>
              <Icon size={28} className={`${color} opacity-30 group-hover:opacity-60 transition-opacity`} />
            </div>
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Sparkles size={12} className="text-indigo-400" />
            </div>
          </div>
        ))}
      </div>

      {/* Permission Matrix - Soft Blue Theme */}
      {loading ? (
        <div className="rounded-2xl bg-white/80 backdrop-blur-sm border border-indigo-100 p-20 flex flex-col items-center justify-center text-gray-400 shadow-xl shadow-indigo-100/20">
          <div className="w-12 h-12 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
          <p className="text-xs font-black uppercase tracking-widest text-gray-500">Loading permission matrix...</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white/80 backdrop-blur-sm border border-indigo-100 overflow-hidden shadow-xl shadow-indigo-100/20">
          <div className="px-5 py-4 border-b border-indigo-100 bg-gradient-to-r from-indigo-50/50 to-blue-50/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-indigo-600" />
              <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Permission Matrix</h2>
            </div>
            <div className="flex items-center gap-3">
              {!canEditPermissions && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle size={10} className="text-amber-600" />
                  <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Read-Only</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                {ACCESS_LEVEL_OPTIONS.map((opt) => {
                  const style = ACCESS_LEVEL_COLORS[opt.value];
                  return (
                    <div key={opt.value} className="flex items-center gap-1.5">
                      <div className={`w-5 h-5 rounded-lg ${style.bg} border ${style.border} flex items-center justify-center`}>
                        {style.icon}
                      </div>
                      <span className={`text-[8px] font-bold ${style.text}`}>{style.badge}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
            <table className="w-full text-sm" style={{ minWidth: 1600 }}>
              <thead>
                <tr className="bg-gradient-to-r from-indigo-50/80 to-blue-50/80 border-b border-indigo-100">
                  <th className="sticky left-0 z-10 bg-indigo-50/80 px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500" style={{ width: 200, minWidth: 200 }}>
                    Module
                  </th>
                  {ROLE_KEYS.map((roleKey) => {
                    const role = ROLE_META[roleKey];
                    return (
                      <th key={roleKey} className="px-3 py-3 text-center align-top" style={{ minWidth: 130 }}>
                        <div className="flex flex-col items-center gap-1">
                          <div className={`p-2 rounded-xl ${role.bgColor} shadow-sm`}>
                            <span className={role.color}>{role.icon}</span>
                          </div>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-700">{role.label}</span>
                          {canEditPermissions && (
                            <div className="flex gap-1 pt-1">
                              <button 
                                type="button" 
                                onClick={() => applyRolePreset(roleKey, "VIEW")} 
                                className="px-1.5 py-0.5 text-[7px] font-bold rounded border border-gray-200 text-gray-500 hover:text-amber-600 hover:border-amber-300 hover:bg-amber-50 transition-all"
                                title="View only"
                              >
                                V
                              </button>
                              <button 
                                type="button" 
                                onClick={() => applyRolePreset(roleKey, "VIEW_EDIT")} 
                                className="px-1.5 py-0.5 text-[7px] font-bold rounded border border-gray-200 text-gray-500 hover:text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-all"
                                title="View & Edit"
                              >
                                E
                              </button>
                              <button 
                                type="button" 
                                onClick={() => applyRolePreset(roleKey, "VIEW_CONTROL")} 
                                className="px-1.5 py-0.5 text-[7px] font-bold rounded border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition-all"
                                title="Full Control"
                              >
                                C
                              </button>
                              <button 
                                type="button" 
                                onClick={() => applyRolePreset(roleKey, "HIDDEN")} 
                                className="px-1.5 py-0.5 text-[7px] font-bold rounded border border-gray-200 text-gray-500 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 transition-all"
                                title="Hidden"
                              >
                                H
                              </button>
                            </div>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50">
                {MODULE_ACCESS_META.map((module) => (
                  <tr key={module.key} className="hover:bg-indigo-50/30 transition-colors group">
                    <td className="sticky left-0 z-10 bg-white/80 backdrop-blur-sm px-4 py-3 group-hover:bg-indigo-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-lg bg-gradient-to-br ${getModuleGradient(module.key)} text-indigo-600 shadow-sm`}>
                          {getModuleIcon(module.key)}
                        </div>
                        <span className="font-bold text-gray-800 text-xs uppercase tracking-wider">{module.label}</span>
                      </div>
                    </td>
                    {ROLE_KEYS.map((roleKey) => {
                      const level = normalizedRoleAccess[module.key]?.[roleKey] || "HIDDEN";
                      const checks = checksFromAccess(level);
                      const style = ACCESS_LEVEL_COLORS[level] || ACCESS_LEVEL_COLORS.HIDDEN;
                      return (
                        <td key={roleKey} className="px-3 py-2 text-center">
                          {canEditPermissions ? (
                            <div className={`rounded-xl border px-2 py-1.5 ${style.bg} ${style.border} transition-all hover:shadow-md ${style.hover}`}>
                              <div className="grid grid-cols-3 gap-1">
                                {[
                                  ["view", "V"],
                                  ["edit", "E"],
                                  ["control", "C"],
                                ].map(([key, label]) => (
                                  <button
                                    key={key}
                                    type="button"
                                    onClick={() => toggleAccessCheck(module.key, roleKey, key)}
                                    className={`h-7 rounded-lg border text-[9px] font-bold transition-all ${
                                      checks[key] 
                                        ? "bg-gradient-to-r from-indigo-500 to-blue-600 text-white border-indigo-400 shadow-lg shadow-indigo-400/30 scale-105" 
                                        : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50"
                                    }`}
                                    title={`${label === "V" ? "View" : label === "E" ? "Edit" : "Control"} access`}
                                  >
                                    {checks[key] ? <Check size={11} className="mx-auto" /> : label}
                                  </button>
                                ))}
                              </div>
                              <p className={`mt-0.5 text-[7px] font-bold uppercase tracking-wider ${style.text}`}>
                                {formatAccessLevel(level)}
                              </p>
                            </div>
                          ) : (
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}>
                              {style.icon}
                              {style.badge}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-indigo-100 bg-gradient-to-r from-indigo-50/50 to-blue-50/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Legend:</span>
              {ACCESS_LEVEL_OPTIONS.map((opt) => {
                const style = ACCESS_LEVEL_COLORS[opt.value];
                return (
                  <div key={opt.value} className="flex items-center gap-1.5">
                    <div className={`w-5 h-5 rounded-lg ${style.bg} border ${style.border} flex items-center justify-center`}>
                      {style.icon}
                    </div>
                    <span className={`text-[8px] font-bold ${style.text}`}>{style.badge}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 text-[8px] text-gray-500">
              <ShieldCheck size={12} className="text-indigo-500" />
              <span className="font-medium">V = View | E = Edit | C = Control</span>
              <Gem size={10} className="text-indigo-300 ml-1" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleAccess;