import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, ShieldCheck, Monitor, Eye, EyeOff, Lock, AlertCircle, CheckCircle, Users, HardDrive } from "lucide-react";
import { roleAccessApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import {
  ACCESS_LEVEL_OPTIONS,
  MODULE_ACCESS_META,
  getRoleAccessSettings,
  normalizeRoleAccessSettings,
  saveRoleAccessSettings,
} from "../utils/roleAccess";

// Color mapping for access levels - matching the actual values from ACCESS_LEVEL_OPTIONS
const ACCESS_LEVEL_COLORS = {
  "HIDDEN": { bg: "bg-danger/10", text: "text-danger", border: "border-danger/20", badge: "Hidden", icon: <EyeOff size={12} /> },
  "VIEW": { bg: "bg-warning/10", text: "text-warning", border: "border-warning/20", badge: "View Only", icon: <Eye size={12} /> },
  "EDIT": { bg: "bg-accent/10", text: "text-accent", border: "border-accent/20", badge: "Edit", icon: <CheckCircle size={12} /> },
  "FULL": { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20", badge: "Full Access", icon: <ShieldCheck size={12} /> },
};

const ROLE_LABELS = {
  admin: { label: "Administrator", icon: <ShieldCheck size={14} />, color: "text-danger" },
  engineer: { label: "Engineer", icon: <HardDrive size={14} />, color: "text-accent" },
  supervisor: { label: "Supervisor", icon: <Users size={14} />, color: "text-warning" },
  operator: { label: "Operator", icon: <Monitor size={14} />, color: "text-primary" },
};

const RoleAccess = () => {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);
  const isAdmin = String(user.role || "").trim().toLowerCase() === "admin";

  const [roleAccessSettings, setRoleAccessSettings] = useState(() => getRoleAccessSettings());
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState(null);
  const [saving, setSaving] = useState(false);

  const normalizedRoleAccess = useMemo(
    () => normalizeRoleAccessSettings(roleAccessSettings),
    [roleAccessSettings]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const ra = await roleAccessApi.list().catch(() => null);
      if (ra) setRoleAccessSettings(ra);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveSettings = async () => {
    if (!isAdmin) {
      setPopup({
        type: "ERROR",
        title: "Access Denied",
        message: "Only administrators can modify role permissions.",
      });
      return;
    }
    setSaving(true);
    try {
      await roleAccessApi.save(normalizedRoleAccess);
      saveRoleAccessSettings(roleAccessSettings);
      setPopup({
        type: "SUCCESS",
        title: "Permissions Saved",
        message: "Role access matrix has been updated successfully.",
      });
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Save Error",
        message: error.response?.data?.error || "Unable to save role configuration.",
      });
    } finally {
      setSaving(false);
    }
  };

  const getAccessLevelStyle = (level) => {
    return ACCESS_LEVEL_COLORS[level] || ACCESS_LEVEL_COLORS.HIDDEN;
  };

  // Calculate statistics
  const stats = useMemo(() => {
    const modules = MODULE_ACCESS_META.length;
    const roles = ["admin", "engineer", "supervisor", "operator"];
    let fullAccess = 0;
    let editAccess = 0;
    let viewAccess = 0;
    let hidden = 0;

    roles.forEach(role => {
      MODULE_ACCESS_META.forEach(module => {
        const level = normalizedRoleAccess[module.key]?.[role] || "HIDDEN";
        if (level === "FULL") fullAccess++;
        else if (level === "EDIT") editAccess++;
        else if (level === "VIEW") viewAccess++;
        else hidden++;
      });
    });

    return { modules, roles: roles.length, fullAccess, editAccess, viewAccess, hidden };
  }, [normalizedRoleAccess]);

  return (
    <div className="space-y-6 rise-in" style={{ fontFamily: "var(--font-outfit)" }}>
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} />

      {/* Header matching Station Control */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 className="db-header-title">Role Access Control</h1>
              <p className="db-header-subtitle">Define module permissions by user role</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={saveSettings} 
              disabled={!isAdmin || saving} 
              className="db-action-btn"
            >
              {saving ? <div className="animate-spin">⏳</div> : <Save size={14} />} 
              {saving ? "Saving..." : "Save Permissions"}
            </button>
          </div>
        </div>
      </div>

      {/* Compact Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Modules</p>
              <p className="text-2xl font-black text-primary font-mono">{stats.modules}</p>
            </div>
            <HardDrive size={28} className="text-primary/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Full Access</p>
              <p className="text-2xl font-black text-primary font-mono">{stats.fullAccess}</p>
            </div>
            <ShieldCheck size={28} className="text-primary/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Edit Access</p>
              <p className="text-2xl font-black text-accent font-mono">{stats.editAccess}</p>
            </div>
            <CheckCircle size={28} className="text-accent/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">View Only</p>
              <p className="text-2xl font-black text-warning font-mono">{stats.viewAccess}</p>
            </div>
            <Eye size={28} className="text-warning/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Restricted</p>
              <p className="text-2xl font-black text-danger font-mono">{stats.hidden}</p>
            </div>
            <Lock size={28} className="text-danger/30" />
          </div>
        </div>
      </div>

      {/* Permission Matrix Table */}
      {loading ? (
        <div className="industrial-card p-20 flex flex-col items-center justify-center text-slate-700/80">
          <div className="animate-spin mb-4">⏳</div>
          <p className="text-xs font-black uppercase tracking-widest">Loading permission matrix...</p>
        </div>
      ) : (
        <div className="industrial-card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-bg-dark/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-primary" />
              <h2 className="text-[10px] font-black text-text-main uppercase tracking-wider">Permission Matrix</h2>
            </div>
            <div className="flex items-center gap-3">
              {!isAdmin && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-warning/10 border border-warning/20 rounded">
                  <AlertCircle size={10} className="text-warning" />
                  <span className="text-[9px] font-black text-warning uppercase tracking-wider">Read-Only Mode</span>
                </div>
              )}
              <span className="text-[9px] font-black text-text-muted uppercase tracking-widest bg-bg-dark px-2 py-1 rounded border border-border">
                {MODULE_ACCESS_META.length} Modules
              </span>
            </div>
          </div>
          
          <div className="overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
            <style>{`
              .permission-table::-webkit-scrollbar { height: 6px; }
              .permission-table::-webkit-scrollbar-track { background: rgba(15,23,42,0.05); border-radius: 3px; }
              .permission-table::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.2); border-radius: 3px; }
            `}</style>
            
            <table className="permission-table w-full text-sm" style={{ minWidth: 800 }}>
              <thead>
                <tr style={{ background: "rgba(15,23,42,0.04)", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
                  <th style={{ padding: "12px 16px", width: 200 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(15,23,42,0.75)" }}>
                      Module
                    </span>
                  </th>
                  {Object.entries(ROLE_LABELS).map(([key, role]) => (
                    <th key={key} style={{ padding: "12px 16px", textAlign: "center" }}>
                      <div className="flex flex-col items-center gap-1">
                        <div className={`${role.color}`}>
                          {role.icon}
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(15,23,42,0.75)" }}>
                          {role.label}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {MODULE_ACCESS_META.map((row) => (
                  <tr key={row.key} className="hover:bg-primary/5 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        <span className="font-black text-text-main text-xs uppercase tracking-wider">
                          {row.label}
                        </span>
                      </div>
                    </td>
                    {["admin", "engineer", "supervisor", "operator"].map((roleKey) => {
                      const level = normalizedRoleAccess[row.key]?.[roleKey] || "HIDDEN";
                      const levelStyle = getAccessLevelStyle(level);
                      const isEditable = isAdmin;
                      
                      return (
                        <td key={roleKey} className="px-4 py-3 text-center">
                          {isEditable ? (
                            <select
                              value={level}
                              onChange={(e) => {
                                const next = {
                                  ...roleAccessSettings,
                                  [row.key]: {
                                    ...(roleAccessSettings[row.key] || {}),
                                    [roleKey]: e.target.value,
                                  },
                                };
                                setRoleAccessSettings(next);
                              }}
                              className={`w-full px-2 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-primary/30 ${levelStyle.bg} ${levelStyle.text} ${levelStyle.border}`}
                            >
                              {ACCESS_LEVEL_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${levelStyle.bg} ${levelStyle.text} ${levelStyle.border}`}>
                              {levelStyle.icon}
                              {levelStyle.badge}
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
          
          {/* Legend */}
          <div className="px-5 py-3 border-t border-border bg-bg-dark/30 flex items-center gap-4 flex-wrap">
            <span className="text-[9px] font-black text-text-muted uppercase tracking-wider mr-2">Access Levels:</span>
            {ACCESS_LEVEL_OPTIONS.map((opt) => {
              const style = ACCESS_LEVEL_COLORS[opt.value];
              // Add safety check
              if (!style) return null;
              return (
                <div key={opt.value} className="flex items-center gap-1.5">
                  <div className={`w-5 h-5 rounded ${style.bg} border ${style.border} flex items-center justify-center`}>
                    {style.icon}
                  </div>
                  <span className={`text-[9px] font-bold ${style.text}`}>{style.badge}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleAccess;