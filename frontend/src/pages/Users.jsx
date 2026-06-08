import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, UserPlus, Edit, Trash2, Search, Shield, UserCog,
  X, Calendar, RefreshCw, ChevronUp, ChevronDown, CheckCircle, Layout,
  Key, BadgeCheck, AlertCircle
} from "lucide-react";
import toast from "react-hot-toast";
import { userApi } from "../api/services";
import ConfirmModal from "../components/ConfirmModal";
import { getUserRole } from "../utils/authStorage";
import { canEditModule, getRoleAccessSettings } from "../utils/roleAccess";

const DEFAULT_FORM = { username: "", password: "", role: "Operator", status: "ACTIVE" };

const ROLE_STYLE = {
  Admin:      "bg-danger/10 text-danger border-danger/20",
  Engineer:   "bg-accent/10 text-accent border-accent/20",
  Supervisor: "bg-warning/10 text-warning border-warning/20",
  Operator:   "bg-primary/10 text-primary border-primary/20",
  Other:      "bg-bg-dark text-text-muted border-border",
};

const ROLE_ICONS = {
  Admin:      <Shield size={12} />,
  Engineer:   <UserCog size={12} />,
  Supervisor: <BadgeCheck size={12} />,
  Operator:   <Users size={12} />,
  Other:      <Shield size={12} />,
};

const USER_ROLES = ["Operator", "Engineer", "Supervisor", "Admin", "Other"];

const UsersPage = () => {
  const [users, setUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState({ key: "username", direction: "asc" });
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const canManageUsers = useMemo(
    () => canEditModule(getUserRole(), "users", getRoleAccessSettings()),
    []
  );

  const fetchUsers = useCallback(async () => {
    try {
      const data = await userApi.list();
      setUsers(data || []);
    } catch { toast.error("Failed to load user database"); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const resetForm = () => { setFormData(DEFAULT_FORM); setEditingUser(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canManageUsers) {
      toast.error("You do not have permission to manage users.");
      return;
    }
    setLoading(true);
    try {
      if (editingUser) {
        const payload = { ...formData };
        if (!payload.password) delete payload.password;
        await userApi.update(editingUser.id, payload);
        toast.success("User credentials updated successfully");
      } else {
        await userApi.create(formData);
        toast.success(`User "${formData.username}" has been enrolled`);
      }
      await fetchUsers();
      setShowModal(false);
      resetForm();
    } catch (err) { 
      toast.error(err.response?.data?.error || "Operation failed. Please try again."); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    if (!canManageUsers) {
      toast.error("You do not have permission to manage users.");
      setDeleteTarget(null);
      return;
    }
    try {
      await userApi.remove(deleteTarget.id);
      toast.success(`Access revoked for ${deleteTarget.username}`);
      await fetchUsers();
    } catch { 
      toast.error("Failed to revoke access"); 
    } finally { 
      setDeleteTarget(null); 
    }
  };

  const handleOpenEdit = (user) => {
    if (!canManageUsers) {
      toast.error("You do not have permission to edit users.");
      return;
    }
    setEditingUser(user);
    setFormData({
      username: user.username || "",
      password: "",
      role: user.role || "Operator",
      status: user.status || "ACTIVE",
    });
    setShowModal(true);
  };

  const handleSort = (key) => {
    setSortConfig((prev) => ({ 
      key, 
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" 
    }));
  };

  const sortedUsers = useMemo(() => {
    const filtered = users.filter((u) => {
      const matchesRole = roleFilter === "all" || u.role === roleFilter;
      const keyword = searchTerm.toLowerCase();
      return matchesRole && (
        u.username.toLowerCase().includes(keyword) || 
        u.role.toLowerCase().includes(keyword)
      );
    });
    return [...filtered].sort((a, b) => {
      const aVal = String(a[sortConfig.key] || "");
      const bVal = String(b[sortConfig.key] || "");
      return aVal < bVal ? (sortConfig.direction === "asc" ? -1 : 1) : aVal > bVal ? (sortConfig.direction === "asc" ? 1 : -1) : 0;
    });
  }, [roleFilter, searchTerm, sortConfig, users]);

  const roleCount = useMemo(() => {
    return Object.fromEntries(
      USER_ROLES.map((r) => [
        r, 
        users.filter((u) => u.role === r).length
      ])
    );
  }, [users]);

  const getStatusColor = (status) => {
    return status === 'ACTIVE' ? '#10b981' : '#ef4444';
  };

  return (
    <div className="space-y-6 rise-in" style={{ fontFamily: "var(--font-outfit)" }}>
      {/* Header matching Station Control */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <Users size={22} />
            </div>
            <div>
              <h1 className="db-header-title">User Management</h1>
              <p className="db-header-subtitle">Manage personnel hierarchy and role-based permissions</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => fetchUsers()} className="db-action-btn">
              <RefreshCw size={14} /> Refresh
            </button>
            <button 
              onClick={() => {
                if (!canManageUsers) {
                  toast.error("You do not have permission to add users.");
                  return;
                }
                resetForm();
                setShowModal(true);
              }}
              disabled={!canManageUsers}
              className="db-action-btn"
            >
              <UserPlus size={14} /> Add User
            </button>
          </div>
        </div>
      </div>

      {/* Compact Stats Cards */}
      <div className="grid grid-cols-4 gap-3">
        {Object.entries(roleCount).map(([role, count]) => (
          <button 
            key={role} 
            onClick={() => setRoleFilter(roleFilter === role ? "all" : role)}
            className={`industrial-card p-3 transition-all group ${
              roleFilter === role 
                ? "border-primary shadow-lg shadow-primary/5 ring-1 ring-primary/20" 
                : "hover:border-primary/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-black text-text-main leading-none">{count}</p>
                <div className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${ROLE_STYLE[role]}`}>
                  {ROLE_ICONS[role]}
                  {role}
                </div>
              </div>
              <div className="opacity-50 group-hover:opacity-100 transition-opacity">
                {ROLE_ICONS[role]}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Search and Filter Bar */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={14} />
          <input 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
            placeholder="Search by username or role..." 
            className="w-full bg-bg-card border border-border rounded-lg py-2.5 pl-9 pr-3 focus:border-primary/50 text-text-main text-sm outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setShowRoleDropdown(!showRoleDropdown)}
            className="w-full md:w-40 bg-bg-card border border-border rounded-lg px-4 py-2.5 text-text-main text-sm font-medium flex items-center justify-between hover:border-primary/50 transition-all"
          >
            <span>{roleFilter === "all" ? "All Roles" : roleFilter}</span>
            <ChevronDown size={14} className="opacity-50" />
          </button>
          {showRoleDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowRoleDropdown(false)} />
              <div className="absolute top-full left-0 mt-1 w-full bg-bg-card border border-border rounded-lg shadow-lg z-20 overflow-hidden">
                <div 
                  onClick={() => { setRoleFilter("all"); setShowRoleDropdown(false); }}
                  className={`px-3 py-2 text-xs cursor-pointer hover:bg-primary/10 transition-colors ${roleFilter === "all" ? "text-primary font-bold" : "text-text-main"}`}
                >
                  All Roles
                </div>
                {USER_ROLES.map((r) => (
                  <div 
                    key={r}
                    onClick={() => { setRoleFilter(r); setShowRoleDropdown(false); }}
                    className={`px-3 py-2 text-xs cursor-pointer hover:bg-primary/10 transition-colors ${roleFilter === r ? "text-primary font-bold" : "text-text-main"}`}
                  >
                    {r}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="industrial-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg-dark/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layout size={14} className="text-primary" />
            <h2 className="text-xs font-bold text-text-main uppercase tracking-wider">User Directory</h2>
          </div>
          <span className="text-[9px] font-black text-text-muted uppercase tracking-widest bg-bg-dark px-2 py-1 rounded border border-border">
            {sortedUsers.length} User{sortedUsers.length !== 1 ? "s" : ""}
          </span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-dark/70 text-[9px] font-bold uppercase tracking-widest text-text-muted border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-primary transition-colors" onClick={() => handleSort('username')}>
                  <div className="flex items-center gap-1">
                    User <SortIcon active={sortConfig.key === "username"} direction={sortConfig.direction} />
                  </div>
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-primary transition-colors" onClick={() => handleSort('role')}>
                  <div className="flex items-center gap-1">
                    Role <SortIcon active={sortConfig.key === "role"} direction={sortConfig.direction} />
                  </div>
                </th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-text-muted">
                    <Users size={36} className="mx-auto opacity-10 mb-3" />
                    <p className="text-xs font-medium">No users found</p>
                    <p className="text-[10px] mt-1 opacity-60">Try adjusting your search or filter</p>
                  </td>
                </tr>
              ) : (
                sortedUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-bg-dark/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-bg-dark border border-border flex items-center justify-center text-primary">
                          <UserCog size={14} />
                        </div>
                        <p className="font-bold text-text-main text-sm">{user.username}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black tracking-wider border ${ROLE_STYLE[user.role] || ROLE_STYLE.Operator}`}>
                        {ROLE_ICONS[user.role]}
                        {user.role.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-text-muted">
                        <Calendar size={11} />
                        {new Date(user.createdAt).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div 
                          className="w-1.5 h-1.5 rounded-full animate-pulse" 
                          style={{ background: getStatusColor(user.status) }}
                        />
                        <span 
                          className="text-[9px] font-black uppercase tracking-wider"
                          style={{ color: getStatusColor(user.status) }}
                        >
                          {user.status || 'ACTIVE'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => handleOpenEdit(user)} 
                          disabled={!canManageUsers}
                          className="p-1.5 text-text-muted hover:text-primary hover:bg-primary/10 rounded transition-all"
                          title="Edit user"
                        >
                          <Edit size={13} />
                        </button>
                        <button 
                          onClick={() => canManageUsers ? setDeleteTarget(user) : toast.error("You do not have permission to delete users.")} 
                          disabled={!canManageUsers}
                          className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded transition-all"
                          title="Delete user"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bg-dark/90 backdrop-blur-md" onClick={() => setShowModal(false)} />
          <div className="relative industrial-card p-0 w-full max-w-md overflow-hidden rise-in border-accent/20">
            <div className="p-5 border-b border-border flex items-center justify-between bg-bg-dark/30">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 text-primary rounded-lg border border-primary/20">
                  <Shield size={16} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-text-main">
                    {editingUser ? 'Edit User' : 'Add User'}
                  </h2>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {editingUser ? 'Update user permissions' : 'Create new system account'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowModal(false)} 
                className="text-text-muted hover:text-text-main transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                  <UserCog size={10} /> Username
                </label>
                <input 
                  required 
                  value={formData.username} 
                  onChange={e => setFormData({...formData, username: e.target.value})} 
                  placeholder="e.g., john.doe" 
                  className="w-full bg-bg-dark border border-border rounded-lg p-2.5 text-text-main text-sm outline-none focus:border-primary/50 transition-all"
                />
              </div>
              
              <div className="space-y-1">
                <label className="text-[9px] font-black text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                  <Key size={10} /> {editingUser ? 'New Password (Optional)' : 'Password'}
                </label>
                <input 
                  type="password" 
                  value={formData.password} 
                  onChange={e => setFormData({...formData, password: e.target.value})} 
                  required={!editingUser} 
                  placeholder="••••••••" 
                  className="w-full bg-bg-dark border border-border rounded-lg p-2.5 text-text-main text-sm outline-none focus:border-primary/50 transition-all font-mono"
                />
                {editingUser && (
                  <p className="text-[9px] text-text-muted mt-1">
                    Leave blank to keep current password
                  </p>
                )}
              </div>
              
              <div className="space-y-2">
                <label className="text-[9px] font-black text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                  <Shield size={10} /> Role
                </label>
                <select
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value })}
                  className="w-full bg-bg-dark border border-border rounded-lg p-2.5 text-text-main text-sm outline-none focus:border-primary/50 transition-all font-medium"
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="space-y-1">
                <label className="text-[9px] font-black text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                  <AlertCircle size={10} /> Status
                </label>
                <select 
                  value={formData.status} 
                  onChange={e => setFormData({...formData, status: e.target.value})} 
                  className="w-full bg-bg-dark border border-border rounded-lg p-2.5 text-text-main text-sm outline-none focus:border-primary/50 transition-all font-medium"
                >
                  <option value="ACTIVE">✓ ACTIVE - Full Access</option>
                  <option value="INACTIVE">✗ INACTIVE - Suspended</option>
                </select>
              </div>
              
              <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)} 
                  className="px-4 py-2 text-[10px] font-black uppercase text-text-muted hover:text-text-main transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={loading} 
                  className="px-5 py-2 bg-primary text-on-strong font-black rounded-lg text-[10px] uppercase shadow-lg shadow-primary/10 flex items-center gap-1.5 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <RefreshCw className="animate-spin" size={12} /> : <CheckCircle size={12} />} 
                  {editingUser ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete User"
        message={
          <div>
            <p>Are you sure you want to delete user <strong className="text-danger">{deleteTarget?.username}</strong>?</p>
            <p className="text-xs text-text-muted mt-2">This action cannot be undone.</p>
          </div>
        }
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
};

const SortIcon = ({ active, direction }) => {
  if (!active) {
    return <ChevronUp size={10} className="inline-block ml-1 opacity-30" />;
  }
  return direction === "asc" ? (
    <ChevronUp size={10} className="inline-block ml-1 text-primary" />
  ) : (
    <ChevronDown size={10} className="inline-block ml-1 text-primary" />
  );
};

export default UsersPage;
