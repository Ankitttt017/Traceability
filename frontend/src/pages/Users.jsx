import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  Calendar,
  Camera,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Edit,
  IdCard,
  Key,
  Layout,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  X,
  Filter,
  Eye,
  EyeOff,
  Briefcase,
  Clock,
  Award,
  Crown,
  Zap,
  Target,
  Upload,
  User,
  AtSign,
  Hash,
  Sparkles,
  Gem,
} from "lucide-react";
import toast from "react-hot-toast";
import { organizationApi, userApi } from "../api/services";
import ConfirmModal from "../components/ConfirmModal";
import { getUser, getUserRole, setAuthSession } from "../utils/authStorage";
import {
  MODULE_ACCESS_META,
  canEditModule,
  getRoleAccessSettings,
  normalizePageAccessOverrides,
  USER_ROLE_OPTIONS,
} from "../utils/roleAccess";

const DEFAULT_FORM = {
  fullName: "",
  username: "",
  role: "Operator",
  plantId: "",
  employeeCode: "",
  email: "",
  phoneNumber: "",
  profileImageUrl: "",
  profileImageFile: null,
  password: "",
  confirmPassword: "",
  status: "ACTIVE",
};

// Enhanced role styling
const ROLE_STYLE = {
  "Super Admin": "bg-danger/10 text-danger border-danger/20",
  "Company Admin": "bg-danger/10 text-danger border-danger/20",
  "Plant Admin": "bg-warning/10 text-warning border-warning/20",
  "Production Manager": "bg-accent/10 text-accent border-accent/20",
  "Quality Manager": "bg-primary/10 text-primary border-primary/20",
  Maintenance: "bg-warning/10 text-warning border-warning/20",
  Engineer: "bg-accent/10 text-accent border-accent/20",
  Supervisor: "bg-warning/10 text-warning border-warning/20",
  Operator: "bg-primary/10 text-primary border-primary/20",
  Auditor: "bg-bg-dark text-text-main border-border",
  Viewer: "bg-bg-dark text-text-muted border-border",
};

const ROLE_ICONS = {
  "Super Admin": <Crown size={12} className="text-danger" />,
  "Company Admin": <Shield size={12} className="text-danger" />,
  "Plant Admin": <Building2 size={12} className="text-warning" />,
  "Production Manager": <Briefcase size={12} className="text-accent" />,
  "Quality Manager": <BadgeCheck size={12} className="text-primary" />,
  Maintenance: <Zap size={12} className="text-warning" />,
  Engineer: <Target size={12} className="text-accent" />,
  Supervisor: <Award size={12} className="text-warning" />,
  Operator: <UserCog size={12} className="text-primary" />,
  Auditor: <Shield size={12} className="text-text-main" />,
  Viewer: <Eye size={12} className="text-text-muted" />,
};

const USER_ROLES = USER_ROLE_OPTIONS.map((role) => role.value);

function roleIcon(role) {
  return ROLE_ICONS[role] || <UserCog size={12} className="text-primary" />;
}

function getPlantName(plants, plantId) {
  if (!plantId) return "All Plants";
  const plant = plants.find((entry) => String(entry.id) === String(plantId));
  return plant?.plantName || plant?.plant_name || `Plant ${plantId}`;
}

// Professional Avatar Component
const UserAvatar = ({ user, size = "md" }) => {
  const sizeMap = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };
  
  const sizeClass = sizeMap[size] || sizeMap.md;
  const textSize = size === "sm" ? "text-xs" : size === "lg" ? "text-lg" : "text-sm";
  
  const getInitials = (name) => {
    if (!name) return "?";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getColorFromName = (name) => {
    const colors = [
      "bg-blue-500", "bg-purple-500", "bg-pink-500", "bg-red-500",
      "bg-orange-500", "bg-amber-500", "bg-emerald-500", "bg-teal-500",
      "bg-cyan-500", "bg-indigo-500", "bg-violet-500", "bg-rose-500"
    ];
    if (!name) return colors[0];
    const index = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[index % colors.length];
  };

  const displayName = user?.fullName || user?.username || "User";
  const initials = getInitials(displayName);
  const bgColor = getColorFromName(displayName);

  return (
    <div className={`relative flex-shrink-0 ${sizeClass}`}>
      {user?.profileImageUrl ? (
        <div className="w-full h-full rounded-full overflow-hidden border-2 border-primary/20 shadow-lg shadow-primary/10">
          <img 
            src={user.profileImageUrl} 
            alt={displayName}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = "none";
              e.target.parentElement.innerHTML = `
                <div class="w-full h-full rounded-full ${bgColor} flex items-center justify-center text-white font-bold ${textSize}">
                  ${initials}
                </div>
              `;
            }}
          />
        </div>
      ) : (
        <div className={`w-full h-full rounded-full ${bgColor} flex items-center justify-center text-white font-bold ${textSize} shadow-lg shadow-${bgColor}/20`}>
          {initials}
        </div>
      )}
      {user?.status === "ACTIVE" && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-bg-card shadow-lg shadow-green-500/30" />
      )}
      {user?.status === "INACTIVE" && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-bg-card shadow-lg shadow-red-500/30" />
      )}
    </div>
  );
};

// Enhanced Avatar Upload Component
const AvatarUpload = ({ user, onImageChange, onRemoveImage }) => {
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(user?.profileImageUrl || null);
  const [isDragging, setIsDragging] = useState(false);
  
  const getInitials = (name) => {
    if (!name) return "?";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getColorFromName = (name) => {
    const colors = [
      "bg-blue-500", "bg-purple-500", "bg-pink-500", "bg-red-500",
      "bg-orange-500", "bg-amber-500", "bg-emerald-500", "bg-teal-500",
      "bg-cyan-500", "bg-indigo-500", "bg-violet-500", "bg-rose-500"
    ];
    if (!name) return colors[0];
    const index = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[index % colors.length];
  };

  const displayName = user?.fullName || user?.username || "User";
  const initials = getInitials(displayName);
  const bgColor = getColorFromName(displayName);
  const imageUrl = preview || user?.profileImageUrl;

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result);
        onImageChange(reader.result, file);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    onRemoveImage();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result);
        onImageChange(reader.result, file);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div 
        className={`relative w-28 h-28 cursor-pointer group transition-all duration-300 ${isDragging ? 'scale-105' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {imageUrl ? (
          <div className={`w-full h-full rounded-full overflow-hidden border-3 border-primary/30 shadow-xl shadow-primary/20 transition-all duration-300 group-hover:shadow-primary/40 ${isDragging ? 'border-primary/60 shadow-primary/50' : ''}`}>
            <img 
              src={imageUrl} 
              alt={displayName}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.target.style.display = "none";
                e.target.parentElement.innerHTML = `
                  <div class="w-full h-full rounded-full ${bgColor} flex items-center justify-center text-white font-bold text-3xl">
                    ${initials}
                  </div>
                `;
              }}
            />
          </div>
        ) : (
          <div className={`w-full h-full rounded-full ${bgColor} flex items-center justify-center text-white font-bold text-3xl shadow-xl shadow-${bgColor}/20 border-3 border-white/20 transition-all duration-300 ${isDragging ? 'scale-105 border-primary/50' : ''}`}>
            {initials}
          </div>
        )}
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-black/40 to-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-1">
            <Camera size={24} className="text-white" />
            <span className="text-[8px] font-bold text-white uppercase tracking-wider">Change</span>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 bg-gradient-to-r from-primary/10 to-primary/5 text-primary border border-primary/20 rounded-lg text-[9px] font-bold uppercase hover:from-primary/20 hover:to-primary/10 transition-all flex items-center gap-1.5 shadow-sm"
        >
          <Upload size={11} />
          Browse
        </button>
        {imageUrl && (
          <button
            type="button"
            onClick={handleRemove}
            className="px-3 py-1.5 bg-gradient-to-r from-danger/10 to-danger/5 text-danger border border-danger/20 rounded-lg text-[9px] font-bold uppercase hover:from-danger/20 hover:to-danger/10 transition-all flex items-center gap-1.5 shadow-sm"
          >
            <X size={11} />
            Remove
          </button>
        )}
      </div>
      <p className="text-[8px] text-text-muted">Click or drag & drop to upload</p>
    </div>
  );
};

const UsersPage = () => {
  const [users, setUsers] = useState([]);
  const [plants, setPlants] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState({ key: "username", direction: "asc" });
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [accessTarget, setAccessTarget] = useState(null);
  const [accessDraft, setAccessDraft] = useState({});
  const [savingAccess, setSavingAccess] = useState(false);

  const canManageUsers = useMemo(
    () => canEditModule(getUserRole(), "users", getRoleAccessSettings()),
    []
  );

  const activePlants = useMemo(
    () => plants.filter((plant) => plant.status !== "INACTIVE" && plant.isActive !== false),
    [plants]
  );

  const fetchUsers = useCallback(async () => {
    try {
      const data = await userApi.list();
      setUsers(data || []);
    } catch {
      toast.error("Failed to load user database");
    }
  }, []);

  const fetchPlants = useCallback(async () => {
    try {
      const data = await organizationApi.listPlants();
      setPlants(data || []);
    } catch {
      setPlants([]);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchPlants();
  }, [fetchPlants, fetchUsers]);

  const resetForm = () => {
    setFormData(DEFAULT_FORM);
    setEditingUser(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setImagePreview(null);
  };

  const handleImageChange = (imageUrl, file) => {
    setImagePreview(imageUrl);
    setFormData({ 
      ...formData, 
      profileImageUrl: imageUrl,
      profileImageFile: file 
    });
  };

  const handleRemoveImage = () => {
    setImagePreview(null);
    setFormData({ 
      ...formData, 
      profileImageUrl: "",
      profileImageFile: null 
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canManageUsers) {
      toast.error("You do not have permission to manage users.");
      return;
    }
    if (formData.password || formData.confirmPassword) {
      if (formData.password !== formData.confirmPassword) {
        toast.error("Password and Confirm Password must match.");
        return;
      }
    }

    const payload = {
      fullName: formData.fullName.trim(),
      username: formData.username.trim(),
      role: formData.role,
      plantId: formData.plantId || null,
      employeeCode: formData.employeeCode.trim(),
      email: formData.email.trim(),
      phoneNumber: formData.phoneNumber.trim(),
      profileImageUrl: formData.profileImageUrl.trim(),
      status: formData.status,
    };
    if (formData.password) payload.password = formData.password;

    setLoading(true);
    try {
      if (editingUser) {
        await userApi.update(editingUser.id, payload);
        toast.success("User updated successfully");
      } else {
        await userApi.create(payload);
        toast.success(`User "${formData.username}" created`);
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
      fullName: user.fullName || "",
      username: user.username || "",
      role: user.role || "Operator",
      plantId: user.plantId || "",
      employeeCode: user.employeeCode || "",
      email: user.email || "",
      phoneNumber: user.phoneNumber || "",
      profileImageUrl: user.profileImageUrl || "",
      profileImageFile: null,
      password: "",
      confirmPassword: "",
      status: user.status || "ACTIVE",
    });
    setImagePreview(user.profileImageUrl || null);
    setShowModal(true);
  };

  const openAccessModal = (user) => {
    if (!canManageUsers) {
      toast.error("You do not have permission to manage user access.");
      return;
    }
    const overrides = normalizePageAccessOverrides(user.pageAccessOverrides || {});
    const hasOverrides = Object.keys(overrides).length > 0;
    const initialAccess = Object.fromEntries(
      MODULE_ACCESS_META.map((module) => [
        module.key,
        hasOverrides ? overrides[module.key] !== "HIDDEN" : true,
      ])
    );
    setAccessTarget(user);
    setAccessDraft(initialAccess);
  };

  const saveUserPageAccess = async () => {
    if (!accessTarget) return;
    setSavingAccess(true);
    try {
      const pageAccessOverrides = Object.fromEntries(
        MODULE_ACCESS_META.map((module) => [
          module.key,
          accessDraft[module.key] ? "VIEW" : "HIDDEN",
        ])
      );
      const updatedUser = await userApi.update(accessTarget.id, { pageAccessOverrides });
      const normalizedUser = updatedUser || { ...accessTarget, pageAccessOverrides };
      const currentUser = getUser();
      if (String(currentUser?.id || "") === String(accessTarget.id)) {
        setAuthSession({
          user: {
            ...currentUser,
            pageAccessOverrides,
          },
        });
      }
      setUsers((prev) =>
        prev.map((user) =>
          String(user.id) === String(accessTarget.id)
            ? { ...user, ...normalizedUser, pageAccessOverrides }
            : user
        )
      );
      toast.success(`Page access updated for ${accessTarget.username}`);
      setAccessTarget(null);
      setAccessDraft({});
    } catch (error) {
      toast.error(error.response?.data?.error || "Unable to save page access.");
    } finally {
      setSavingAccess(false);
    }
  };

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const sortedUsers = useMemo(() => {
    const keyword = searchTerm.toLowerCase();
    const filtered = users.filter((user) => {
      const role = user.role || "Operator";
      const matchesRole = roleFilter === "all" || role === roleFilter;
      const plantName = getPlantName(plants, user.plantId);
      return matchesRole && [user.fullName, user.username, role, user.employeeCode, user.email, user.phoneNumber, plantName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });

    return [...filtered].sort((a, b) => {
      const aVal = String(a[sortConfig.key] || "");
      const bVal = String(b[sortConfig.key] || "");
      if (aVal === bVal) return 0;
      return aVal < bVal ? (sortConfig.direction === "asc" ? -1 : 1) : (sortConfig.direction === "asc" ? 1 : -1);
    });
  }, [plants, roleFilter, searchTerm, sortConfig, users]);

  const getStatusColor = (status) => status === "ACTIVE" ? "#10b981" : "#ef4444";

  return (
    <div className="space-y-5 rise-in" style={{ fontFamily: "var(--font-outfit)" }}>
      {/* Header */}
      <div className="db-header-card">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <Users size={20} />
            </div>
            <div>
              <h1 className="db-header-title">User Management</h1>
              <p className="db-header-subtitle">Manage users with plant-based access control</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchUsers} className="db-action-btn">
              <RefreshCw size={13} /> Refresh
            </button>
            <button
              onClick={() => {
                if (!canManageUsers) return toast.error("You do not have permission to add users.");
                resetForm();
                setShowModal(true);
              }}
              disabled={!canManageUsers}
              className="db-action-btn db-action-btn-primary"
            >
              <UserPlus size={13} /> Add User
            </button>
          </div>
        </div>
      </div>

      {/* Search & Filter - Full Width */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={13} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search users by name, username, email, employee code, or role..."
            className="w-full bg-bg-card border border-border rounded-lg py-2.5 pl-9 pr-3 focus:border-primary/50 text-text-main text-sm outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setShowRoleDropdown(!showRoleDropdown)}
            className="w-full md:w-52 bg-bg-card border border-border rounded-lg px-3 py-2.5 text-text-main text-sm font-medium flex items-center justify-between hover:border-primary/50 transition-all"
          >
            <span className="flex items-center gap-1.5 truncate">
              <Filter size={13} className="text-text-muted" />
              <span className="truncate">{roleFilter === "all" ? "All Roles" : roleFilter}</span>
            </span>
            <ChevronDown size={13} className={`opacity-50 transition-transform ${showRoleDropdown ? 'rotate-180' : ''}`} />
          </button>
          {showRoleDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowRoleDropdown(false)} />
              <div className="absolute top-full right-0 mt-1 w-56 max-h-72 overflow-y-auto bg-bg-card border border-border rounded-lg shadow-lg z-20 py-1">
                {["all", ...USER_ROLES].map((role) => (
                  <button
                    key={role}
                    onClick={() => { setRoleFilter(role); setShowRoleDropdown(false); }}
                    className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-primary/10 transition-colors ${
                      roleFilter === role ? "text-primary font-bold" : "text-text-main"
                    }`}
                  >
                    {role === "all" ? "All Roles" : role}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* User Table */}
      <div className="industrial-card p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-bg-dark/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layout size={13} className="text-primary" />
            <h2 className="text-[10px] font-bold text-text-main uppercase tracking-wider">User Directory</h2>
          </div>
          <span className="text-[8px] font-black text-text-muted uppercase tracking-widest bg-bg-dark px-2 py-0.5 rounded border border-border">
            {sortedUsers.length} User{sortedUsers.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 920 }}>
            <thead className="bg-bg-dark/70 text-[8px] font-bold uppercase tracking-widest text-text-muted border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left cursor-pointer hover:text-primary transition-colors" onClick={() => handleSort("username")}>
                  User <SortIcon active={sortConfig.key === "username"} direction={sortConfig.direction} />
                </th>
                <th className="px-4 py-2.5 text-left cursor-pointer hover:text-primary transition-colors" onClick={() => handleSort("role")}>
                  Role <SortIcon active={sortConfig.key === "role"} direction={sortConfig.direction} />
                </th>
                <th className="px-4 py-2.5 text-left">Plant</th>
                <th className="px-4 py-2.5 text-left">Employee Code</th>
                <th className="px-4 py-2.5 text-left">Contact</th>
                <th className="px-4 py-2.5 text-left">Created</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-text-muted">
                    <Users size={32} className="mx-auto opacity-10 mb-2" />
                    <p className="text-xs font-medium">No users found</p>
                  </td>
                </tr>
              ) : sortedUsers.map((user) => (
                <tr key={user.id} className="hover:bg-bg-dark/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar user={user} size="sm" />
                      <div>
                        <p className="font-bold text-text-main text-sm">{user.fullName || user.username}</p>
                        <p className="text-[9px] text-text-muted font-mono">@{user.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-black tracking-wider border ${ROLE_STYLE[user.role] || ROLE_STYLE.Viewer}`}>
                      {roleIcon(user.role)}
                      {String(user.role || "Operator").toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium text-text-main">{getPlantName(plants, user.plantId)}</td>
                  <td className="px-4 py-2.5 text-xs text-text-muted font-mono">{user.employeeCode || "-"}</td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">
                    <div className="space-y-0.5">
                      <p className="flex items-center gap-1">
                        <Mail size={10} className="text-text-muted/40" />
                        {user.email || "-"}
                      </p>
                      <p className="font-mono flex items-center gap-1">
                        <Phone size={10} className="text-text-muted/40" />
                        {user.phoneNumber || "-"}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={10} className="text-text-muted/40" />
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: getStatusColor(user.status) }} />
                      <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: getStatusColor(user.status) }}>
                        {user.status || "ACTIVE"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button 
                      onClick={() => openAccessModal(user)} 
                      disabled={!canManageUsers} 
                      className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed" 
                      title="Page access"
                    >
                      <Shield size={12} />
                    </button>
                    <button 
                      onClick={() => handleOpenEdit(user)} 
                      disabled={!canManageUsers} 
                      className="p-1.5 text-text-muted hover:text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed" 
                      title="Edit user"
                    >
                      <Edit size={12} />
                    </button>
                    <button 
                      onClick={() => canManageUsers ? setDeleteTarget(user) : toast.error("You do not have permission to delete users.")} 
                      disabled={!canManageUsers} 
                      className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed" 
                      title="Delete user"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal - Enhanced Professional Design */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bg-dark/90 backdrop-blur-md" onClick={() => setShowModal(false)} />
          <div className="relative industrial-card p-0 w-full max-w-4xl max-h-[94vh] overflow-hidden rise-in border-accent/20">
            {/* Modal Header with Gradient Accent */}
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary via-accent to-primary" />
            <div className="p-5 border-b border-border flex items-center justify-between bg-bg-dark/30">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-primary/20 to-accent/20 text-primary rounded-xl border border-primary/20 shadow-lg shadow-primary/5">
                  {editingUser ? <Edit size={18} /> : <UserPlus size={18} />}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-text-main">
                    {editingUser ? "Edit User" : "Create New User"}
                  </h2>
                  <p className="text-[10px] text-text-muted flex items-center gap-2">
                    <Sparkles size={10} className="text-accent" />
                    {editingUser ? "Update user profile and permissions" : "Add a new user to the system"}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowModal(false)} 
                className="text-text-muted hover:text-text-main transition-colors p-1.5 hover:bg-bg-dark rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[calc(94vh-86px)]">
              {/* Profile Upload Section - Enhanced */}
              <div className="flex flex-col md:flex-row items-center gap-6 p-5 bg-gradient-to-br from-bg-dark/40 to-bg-dark/20 rounded-xl border border-border relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-accent/5 rounded-full blur-2xl" />
                <AvatarUpload 
                  user={{ 
                    fullName: formData.fullName, 
                    profileImageUrl: imagePreview || formData.profileImageUrl,
                    status: formData.status 
                  }} 
                  onImageChange={handleImageChange}
                  onRemoveImage={handleRemoveImage}
                />
                <div className="flex-1 min-w-0 text-center md:text-left relative z-10">
                  <p className="text-sm font-bold text-text-main">Profile Photo</p>
                  <p className="text-[10px] text-text-muted mt-1">Upload a professional photo for your profile</p>
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mt-2">
                    <span className="text-[9px] text-text-muted flex items-center gap-1 bg-bg-dark/30 px-2 py-1 rounded-full">
                      <CheckCircle size={10} className="text-green-500" />
                      JPG, PNG, GIF
                    </span>
                    <span className="text-[9px] text-text-muted flex items-center gap-1 bg-bg-dark/30 px-2 py-1 rounded-full">
                      <CheckCircle size={10} className="text-green-500" />
                      Max 5MB
                    </span>
                    <span className="text-[9px] text-text-muted flex items-center gap-1 bg-bg-dark/30 px-2 py-1 rounded-full">
                      <Gem size={10} className="text-accent" />
                      Drag & drop supported
                    </span>
                  </div>
                </div>
              </div>

              {/* Form Fields Grid - Enhanced */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <User size={9} className="text-primary" /> Full Name <span className="text-danger">*</span>
                  </label>
                  <input 
                    required 
                    value={formData.fullName} 
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} 
                    placeholder="Enter full name" 
                    className={inputClass} 
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <AtSign size={9} className="text-primary" /> Username <span className="text-danger">*</span>
                  </label>
                  <input 
                    required 
                    value={formData.username} 
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })} 
                    placeholder="Enter username" 
                    className={inputClass} 
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Shield size={9} className="text-primary" /> Role <span className="text-danger">*</span>
                  </label>
                  <select 
                    value={formData.role} 
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })} 
                    className={inputClass}
                  >
                    {USER_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Building2 size={9} className="text-primary" /> Plant
                  </label>
                  <select 
                    value={formData.plantId} 
                    onChange={(e) => setFormData({ ...formData, plantId: e.target.value })} 
                    className={inputClass}
                  >
                    <option value="">All Plants</option>
                    {activePlants.map((plant) => (
                      <option key={plant.id} value={plant.id}>
                        {plant.plantName || plant.plant_name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Hash size={9} className="text-primary" /> Employee Code
                  </label>
                  <input 
                    value={formData.employeeCode} 
                    onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value })} 
                    placeholder="Optional" 
                    className={inputClass} 
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Mail size={9} className="text-primary" /> Email Address
                  </label>
                  <input 
                    type="email" 
                    value={formData.email} 
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })} 
                    placeholder="Optional email" 
                    className={inputClass} 
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Phone size={9} className="text-primary" /> Phone Number
                  </label>
                  <input 
                    value={formData.phoneNumber} 
                    onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })} 
                    placeholder="Optional phone" 
                    className={inputClass} 
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Key size={9} className="text-primary" /> {editingUser ? "New Password" : "Password"} {!editingUser && <span className="text-danger">*</span>}
                  </label>
                  <div className="relative">
                    <input 
                      type={showPassword ? "text" : "password"} 
                      value={formData.password} 
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })} 
                      required={!editingUser} 
                      placeholder={editingUser ? "Leave blank to keep current" : "Enter password"} 
                      className={`${inputClass} font-mono pr-9`} 
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Key size={9} className="text-primary" /> Confirm Password {!editingUser && <span className="text-danger">*</span>}
                  </label>
                  <div className="relative">
                    <input 
                      type={showConfirmPassword ? "text" : "password"} 
                      value={formData.confirmPassword} 
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} 
                      required={!editingUser || !!formData.password} 
                      placeholder="Confirm password" 
                      className={`${inputClass} font-mono pr-9`} 
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <AlertCircle size={9} className="text-primary" /> Account Status <span className="text-danger">*</span>
                  </label>
                  <select 
                    value={formData.status} 
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })} 
                    className={inputClass}
                  >
                    <option value="ACTIVE">🟢 Active - Full Access</option>
                    <option value="INACTIVE">🔴 Inactive - Suspended</option>
                  </select>
                </div>
              </div>

              {/* Form Actions */}
              <div className="pt-3 border-t border-border flex items-center justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)} 
                  className="px-5 py-2 text-[10px] font-black uppercase text-text-muted hover:text-text-main hover:bg-bg-dark rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={loading} 
                  className="px-6 py-2 bg-gradient-to-r from-primary to-accent text-on-strong font-black rounded-lg text-[10px] uppercase shadow-lg shadow-primary/20 flex items-center gap-2 hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {loading ? <RefreshCw className="animate-spin" size={14} /> : <CheckCircle size={14} />}
                  {editingUser ? "Update User" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Individual Page Access Modal */}
      {accessTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bg-dark/90 backdrop-blur-md" onClick={() => setAccessTarget(null)} />
          <div className="relative industrial-card p-0 w-full max-w-3xl max-h-[92vh] overflow-hidden rise-in border-accent/20">
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-accent via-primary to-accent" />
            <div className="p-5 border-b border-border flex items-center justify-between bg-bg-dark/30">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-accent/20 to-primary/20 text-accent rounded-xl border border-accent/20 shadow-lg shadow-accent/5">
                  <Shield size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-text-main">Individual Page Access</h2>
                  <p className="text-[10px] text-text-muted flex items-center gap-2">
                    <UserCog size={10} className="text-accent" />
                    {accessTarget.fullName || accessTarget.username} · {accessTarget.role}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAccessTarget(null)}
                className="text-text-muted hover:text-text-main transition-colors p-1.5 hover:bg-bg-dark rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(92vh-86px)]">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-gradient-to-r from-bg-dark/30 to-bg-dark/10 p-3">
                <div>
                  <p className="text-xs font-bold text-text-main">Selected Pages</p>
                  <p className="text-[10px] text-text-muted">
                    {Object.values(accessDraft).filter(Boolean).length} of {MODULE_ACCESS_META.length} pages enabled
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAccessDraft(Object.fromEntries(MODULE_ACCESS_META.map((module) => [module.key, true])))}
                    className="px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/10 text-primary text-[9px] font-black uppercase tracking-wider hover:bg-primary/20 transition-all"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccessDraft(Object.fromEntries(MODULE_ACCESS_META.map((module) => [module.key, false])))}
                    className="px-3 py-1.5 rounded-lg border border-danger/20 bg-danger/10 text-danger text-[9px] font-black uppercase tracking-wider hover:bg-danger/20 transition-all"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {MODULE_ACCESS_META.map((module) => {
                  const enabled = Boolean(accessDraft[module.key]);
                  return (
                    <button
                      key={module.key}
                      type="button"
                      onClick={() => setAccessDraft((prev) => ({ ...prev, [module.key]: !prev[module.key] }))}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                        enabled
                          ? "border-primary/40 bg-primary/10 shadow-lg shadow-primary/5 text-text-main"
                          : "border-border bg-bg-dark/20 text-text-muted hover:border-primary/30 hover:bg-bg-dark/40"
                      }`}
                    >
                      <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                        enabled ? "border-primary bg-primary text-on-strong shadow-sm" : "border-border bg-bg-card"
                      }`}>
                        {enabled && <CheckCircle size={13} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-black uppercase tracking-wider truncate">
                          {module.label}
                        </span>
                        <span className="block text-[9px] text-text-muted font-mono truncate">
                          {module.key}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-border flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAccessTarget(null)}
                  className="px-5 py-2 text-[10px] font-black uppercase text-text-muted hover:text-text-main hover:bg-bg-dark rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveUserPageAccess}
                  disabled={savingAccess}
                  className="px-6 py-2 bg-gradient-to-r from-primary to-accent text-on-strong font-black rounded-lg text-[10px] uppercase shadow-lg shadow-primary/20 flex items-center gap-2 hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {savingAccess ? <RefreshCw className="animate-spin" size={14} /> : <CheckCircle size={14} />}
                  Save Page Access
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
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

const inputClass = "w-full bg-bg-dark border border-border rounded-lg px-3.5 py-2.5 text-text-main text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-text-muted/40";

const SortIcon = ({ active, direction }) => {
  if (!active) return <ChevronUp size={9} className="inline-block ml-1 opacity-30" />;
  return direction === "asc" 
    ? <ChevronUp size={9} className="inline-block ml-1 text-primary" /> 
    : <ChevronDown size={9} className="inline-block ml-1 text-primary" />;
};

export default UsersPage;