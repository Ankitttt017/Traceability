import { useState } from "react";
import { UserPlus, ShieldPlus, UserCheck, AlertTriangle } from "lucide-react";
import axios from "axios";

const CreateUser = () => {
  const [formData, setFormData] = useState({ username: "", password: "", role: "Operator" });
  const [status, setStatus] = useState({ type: "", message: "" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: "loading", message: "Provisioning user..." });
    try {
      await axios.post("http://localhost:4000/api/auth/register", formData, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setStatus({ type: "success", message: "User created successfully" });
      setFormData({ username: "", password: "", role: "Operator" });
    } catch (err) {
      setStatus({ type: "error", message: err.response?.data?.error || "Failed to create user" });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center space-x-4 mb-8">
        <div className="p-3 bg-blue-600/10 text-blue-500 rounded-2xl border border-blue-600/20">
          <UserPlus size={32} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-slate-500 text-sm">Create and manage access credentials for the production floor.</p>
        </div>
      </div>

      <div className="industrial-card p-8 bg-[#1e293b]/50">
        {status.message && (
          <div className={`p-4 mb-6 rounded-lg text-sm flex items-center space-x-3 ${
            status.type === "success" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : 
            status.type === "error" ? "bg-red-500/10 text-red-400 border border-red-500/30" : 
            "bg-blue-500/10 text-blue-400 border border-blue-500/30"
          }`}>
            {status.type === "success" ? <UserCheck size={18}/> : status.type === "error" ? <AlertTriangle size={18}/> : null}
            <span>{status.message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">Access Name</label>
            <input
              type="text"
              className="w-full bg-[#0f172a] border border-slate-700 rounded-xl py-3 px-4 text-slate-200 focus:outline-none focus:border-blue-500"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">Secure Passphrase</label>
            <input
              type="password"
              className="w-full bg-[#0f172a] border border-slate-700 rounded-xl py-3 px-4 text-slate-200 focus:outline-none focus:border-blue-500"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 ml-1">System Privilege</label>
            <div className="grid grid-cols-2 gap-4">
              {["Operator", "Admin"].map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setFormData({ ...formData, role })}
                  className={`py-3 rounded-xl border-2 transition-all font-bold uppercase tracking-tighter text-sm ${
                    formData.role === role 
                      ? "border-blue-500 bg-blue-500/10 text-blue-400" 
                      : "border-slate-800 bg-slate-800/50 text-slate-500"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl shadow-xl shadow-blue-900/10 transition-all flex items-center justify-center space-x-3"
          >
            <ShieldPlus size={20} />
            <span>CREATE ACCESS KEY</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default CreateUser;
