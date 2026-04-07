import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, ShieldCheck, Monitor } from "lucide-react";
import { roleAccessApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import {
  ACCESS_LEVEL_OPTIONS,
  MODULE_ACCESS_META,
  getRoleAccessSettings,
  normalizeRoleAccessSettings,
  saveRoleAccessSettings,
} from "../utils/roleAccess";

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
    try {
      await roleAccessApi.save(normalizedRoleAccess);
      setPopup({
        type: "SUCCESS",
        title: "Permissions Saved",
        message: "Role access matrix has been updated.",
      });
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Save Error",
        message: error.response?.data?.error || "Unable to save role configuration.",
      });
    }
  };

  return (
    <div className="space-y-6 rise-in">
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} />

      {/* Header */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 className="db-header-title">Role Access</h1>
              <p className="db-header-subtitle">Define module permissions by user role</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={saveSettings} className="db-action-btn">
              <Save size={14} /> Save Permissions
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="industrial-card p-20 flex flex-col items-center justify-center text-text-muted/20">
          <div className="animate-spin mb-4">⏳</div>
          <p className="text-xs font-black uppercase tracking-widest">Loading permission matrix...</p>
        </div>
      ) : (
        <div className="industrial-card p-0 overflow-hidden">
          <div className="px-6 py-5 border-b border-border bg-bg-dark/40 flex items-center justify-between">
            <h2 className="text-sm font-black text-text-main uppercase tracking-widest">
              Global Permission Matrix
            </h2>
            <span className="text-[10px] font-black text-text-muted bg-primary/10 px-2 py-1 rounded border border-primary/20">
              {isAdmin ? "Admin Access" : "Read-Only"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm text-left">
              <thead className="bg-bg-dark/60 text-[10px] font-black text-text-muted uppercase tracking-widest border-b border-border">
                <tr>
                  <th className="px-6 py-4">Module Registry</th>
                  <th className="px-6 py-4">Administrator</th>
                  <th className="px-6 py-4">Engineer</th>
                  <th className="px-6 py-4">Supervisor</th>
                  <th className="px-6 py-4">Operator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {MODULE_ACCESS_META.map((row) => (
                  <tr key={row.key} className="hover:bg-primary/5 transition-colors group">
                    <td className="px-6 py-4 font-black text-text-main tracking-tight uppercase text-xs">
                      {row.label}
                    </td>
                    {["admin", "engineer", "supervisor", "operator"].map((roleKey) => {
                      const level =
                        normalizedRoleAccess[row.key]?.[roleKey] || "HIDDEN";
                      return (
                        <td key={roleKey} className="px-6 py-4">
                          <select
                            value={level}
                            onChange={(e) => {
                              if (!isAdmin) return;
                              const next = {
                                ...roleAccessSettings,
                                [row.key]: {
                                  ...(roleAccessSettings[row.key] || {}),
                                  [roleKey]: e.target.value,
                                },
                              };
                              setRoleAccessSettings(next);
                            }}
                            disabled={!isAdmin}
                            className={`bg-bg-dark/50 border border-border rounded-lg px-2 py-1.5 text-[10px] font-black text-text-main uppercase focus:border-primary focus:outline-none ${
                              !isAdmin ? "opacity-60 cursor-not-allowed" : ""
                            }`}
                          >
                            {ACCESS_LEVEL_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleAccess;