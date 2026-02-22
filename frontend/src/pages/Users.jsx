import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  UserPlus,
  Edit,
  Trash2,
  Search,
  Shield,
  UserCog,
  AlertCircle,
  CheckCircle,
  X,
  Save,
  Key,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { userApi } from "../api/services";

const DEFAULT_FORM = {
  username: "",
  password: "",
  role: "Operator",
  status: "ACTIVE",
};

const UsersPage = () => {
  const [users, setUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState({ key: "username", direction: "asc" });
  const [formData, setFormData] = useState(DEFAULT_FORM);

  const fetchUsers = useCallback(async () => {
    const data = await userApi.list();
    setUsers(data);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers().catch(() => {
        setStatus({ type: "error", message: "Failed to fetch users" });
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  const resetForm = () => {
    setFormData(DEFAULT_FORM);
    setEditingUser(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      if (editingUser) {
        const payload = { ...formData };
        if (!payload.password) {
          delete payload.password;
        }
        await userApi.update(editingUser.id, payload);
        setStatus({ type: "success", message: "User updated successfully" });
      } else {
        await userApi.create(formData);
        setStatus({ type: "success", message: "User created successfully" });
      }
      await fetchUsers();
      setShowModal(false);
      resetForm();
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Operation failed" });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this user?")) {
      return;
    }
    try {
      await userApi.remove(id);
      setStatus({ type: "success", message: "User deleted successfully" });
      await fetchUsers();
    } catch {
      setStatus({ type: "error", message: "Failed to delete user" });
    }
  };

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const sortedUsers = useMemo(() => {
    const filtered = users.filter((user) => {
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const keyword = searchTerm.toLowerCase();
      const matchesSearch =
        user.username.toLowerCase().includes(keyword) || user.role.toLowerCase().includes(keyword);
      return matchesRole && matchesSearch;
    });

    return filtered.sort((a, b) => {
      const aVal = a[sortConfig.key] || "";
      const bVal = b[sortConfig.key] || "";
      if (aVal < bVal) {
        return sortConfig.direction === "asc" ? -1 : 1;
      }
      if (aVal > bVal) {
        return sortConfig.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
  }, [roleFilter, searchTerm, sortConfig.direction, sortConfig.key, users]);

  const getRoleBadgeColor = (role) => {
    if (role === "Admin") {
      return "bg-danger/10 text-danger border border-danger/20";
    }
    if (role === "Supervisor") {
      return "bg-warning/10 text-warning border border-warning/20";
    }
    return "bg-primary/10 text-primary border border-primary/20";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-gradient-to-br from-primary/20 to-accent/20 text-primary rounded-2xl border border-primary/20">
            <Users size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-main">User Management</h1>
            <p className="text-text-muted text-sm">Manage system users and access permissions</p>
          </div>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="flex items-center space-x-2 px-4 py-2 bg-primary hover:brightness-110 text-bg-dark rounded-xl transition-all shadow-lg shadow-primary/20 font-bold"
        >
          <UserPlus size={20} />
          <span>Add User</span>
        </button>
      </div>

      {status.message && (
        <div
          className={`p-4 rounded-lg flex items-center space-x-3 ${
            status.type === "success"
              ? "bg-accent/10 text-accent border border-accent/30"
              : "bg-danger/10 text-danger border border-danger/30"
          }`}
        >
          {status.type === "success" ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span className="flex-1">{status.message}</span>
          <button
            onClick={() => setStatus({ type: "", message: "" })}
            className="p-1 hover:bg-black/20 rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors" size={20} />
          <input
            type="text"
            placeholder="Search users by name or role..."
            className="w-full bg-bg-card border border-border rounded-lg py-3 pl-10 pr-4 text-text-main focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-bg-card border border-border rounded-lg px-4 py-2 text-text-main focus:outline-none focus:border-primary"
          >
            <option value="all">All Roles</option>
            <option value="Admin">Admin</option>
            <option value="Supervisor">Supervisor</option>
            <option value="Operator">Operator</option>
          </select>

          <button
            onClick={() =>
              fetchUsers().catch(() => {
                setStatus({ type: "error", message: "Failed to refresh users" });
              })
            }
            className="p-2 bg-bg-card border border-border rounded-lg hover:border-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className="text-text-muted" />
          </button>
        </div>
      </div>

      <div className="industrial-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-dark/50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Sr No</th>
                <th
                  className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted cursor-pointer hover:text-primary"
                  onClick={() => handleSort("username")}
                >
                  <div className="flex items-center space-x-1">
                    <span>User</span>
                    {sortConfig.key === "username" && <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>}
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted cursor-pointer hover:text-primary"
                  onClick={() => handleSort("role")}
                >
                  <div className="flex items-center space-x-1">
                    <span>Role</span>
                    {sortConfig.key === "role" && <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>}
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted cursor-pointer hover:text-primary"
                  onClick={() => handleSort("createdAt")}
                >
                  <div className="flex items-center space-x-1">
                    <span>Created</span>
                    {sortConfig.key === "createdAt" && <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>}
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">Status</th>
                <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedUsers.length > 0 ? (
                sortedUsers.map((user, index) => (
                  <tr key={user.id} className="hover:bg-bg-dark/30 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-mono text-text-muted">{String(index + 1).padStart(2, "0")}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 flex items-center justify-center">
                          <UserCog size={18} className="text-primary" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-text-main">{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2 text-sm">
                        <Calendar size={14} className="text-text-muted" />
                        <span className="text-text-main">{new Date(user.createdAt).toLocaleDateString()}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <span className={`w-2 h-2 rounded-full ${user.status === "ACTIVE" ? "bg-accent animate-pulse" : "bg-danger"}`} />
                        <span className="text-xs text-text-main">{user.status || "ACTIVE"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEditingUser(user);
                            setFormData({
                              username: user.username,
                              password: "",
                              role: user.role,
                              status: user.status || "ACTIVE",
                            });
                            setShowModal(true);
                          }}
                          className="p-2 hover:bg-primary/10 text-primary rounded-lg transition-all hover:scale-110"
                          title="Edit user"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="p-2 hover:bg-danger/10 text-danger rounded-lg transition-all hover:scale-110"
                          title="Delete user"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center">
                    <Users size={48} className="mx-auto text-text-muted mb-4 opacity-50" />
                    <p className="text-text-muted">No users found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 bg-bg-dark/50 border-t border-border flex items-center justify-between">
          <div className="text-sm text-text-muted">
            Showing <span className="text-primary font-medium">{sortedUsers.length}</span> of{" "}
            <span className="text-primary font-medium">{users.length}</span> users
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-bg-card rounded-xl w-full max-w-md border border-border/50 shadow-2xl">
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h2 className="text-xl font-bold text-text-main flex items-center space-x-2">
                {editingUser ? (
                  <>
                    <Edit size={20} className="text-primary" />
                    <span>Edit User</span>
                  </>
                ) : (
                  <>
                    <UserPlus size={20} className="text-primary" />
                    <span>Create New User</span>
                  </>
                )}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-bg-dark rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted flex items-center justify-between">
                  <span className="flex items-center space-x-1">
                    <UserCog size={14} />
                    <span>Username</span>
                  </span>
                  <span className="text-primary">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter username"
                  className="w-full bg-bg-dark border border-border rounded-lg py-3 px-4 text-text-main focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                  value={formData.username}
                  onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted flex items-center justify-between">
                  <span className="flex items-center space-x-1">
                    <Key size={14} />
                    <span>{editingUser ? "New Password (optional)" : "Password"}</span>
                  </span>
                  {!editingUser && <span className="text-primary">*</span>}
                </label>
                <input
                  type="password"
                  placeholder={editingUser ? "Leave blank to keep current" : "Enter password"}
                  className="w-full bg-bg-dark border border-border rounded-lg py-3 px-4 text-text-main focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  required={!editingUser}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted flex items-center justify-between">
                  <span className="flex items-center space-x-1">
                    <Shield size={14} />
                    <span>Role</span>
                  </span>
                  <span className="text-primary">*</span>
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {["Operator", "Supervisor", "Admin"].map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, role }))}
                      className={`py-3 rounded-lg border-2 transition-all font-bold text-sm ${
                        formData.role === role
                          ? role === "Admin"
                            ? "border-danger bg-danger/10 text-danger"
                            : role === "Supervisor"
                              ? "border-warning bg-warning/10 text-warning"
                              : "border-primary bg-primary/10 text-primary"
                          : "border-border bg-bg-dark/50 text-text-muted hover:border-text-muted"
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value }))}
                  className="w-full bg-bg-dark border border-border rounded-lg py-3 px-4 text-text-main focus:outline-none focus:border-primary"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-6 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 border border-border hover:bg-bg-dark rounded-lg transition-colors text-text-muted hover:text-text-main"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-primary hover:brightness-110 text-bg-dark rounded-xl transition-all flex items-center space-x-2 shadow-lg shadow-primary/20 font-bold"
                >
                  <Save size={18} />
                  <span>{editingUser ? "Update User" : "Create User"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersPage;
