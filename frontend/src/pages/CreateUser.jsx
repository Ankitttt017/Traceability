// ============================================================
//  CreateUser.jsx — IndusTrace Premium Redesign
//  Color Theme: Navy / Steel / Amber / Linen
//  Supports: Dark + Light via [data-theme] on <html>
// ============================================================
import { useState } from "react";
import {
  UserPlus, ShieldPlus, UserCheck, AlertTriangle,
  Eye, EyeOff, Loader2, User, Lock, Shield,
  Wrench, HardHat, ChevronRight,
} from "lucide-react";
import axios from "axios";

// ── Keyframe + theme injection (same pattern as ComponentJourney) ──────────
const STYLES = `
  @keyframes cuSpin    { to { transform: rotate(360deg); } }
  @keyframes cuFadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes cuShake   { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-4px)} 40%,80%{transform:translateX(4px)} }
  @keyframes cuPulse   { 0%,100%{opacity:1}50%{opacity:0.5} }
  :root{
    --cu-navy:    26,50,99;
    --cu-steel:   84,119,146;
    --cu-amber:   250,185,91;
    --cu-linen:   232,226,219;
    --cu-ok:      34,197,94;
    --cu-ng:      239,68,68;
  }
  [data-theme="light"]{
    --cu-bg-base:    248,246,243;
    --cu-bg-card:    255,255,255;
    --cu-bg-surface: 232,226,219;
    --cu-bg-input:   255,255,255;
    --cu-txt-pri:    26,50,99;
    --cu-txt-sec:    84,119,146;
    --cu-txt-muted:  140,160,180;
    --cu-border:     84,119,146;
    --cu-bop:        0.15;
  }
  [data-theme="dark"]{
    --cu-bg-base:    10,18,36;
    --cu-bg-card:    20,34,62;
    --cu-bg-surface: 16,26,50;
    --cu-bg-input:   14,22,44;
    --cu-txt-pri:    232,226,219;
    --cu-txt-sec:    120,160,190;
    --cu-txt-muted:  84,119,146;
    --cu-border:     84,119,146;
    --cu-bop:        0.2;
  }
`;

let cuStylesInjected = false;
function injectStyles() {
  if (cuStylesInjected || typeof document === "undefined") return;
  cuStylesInjected = true;
  const el = document.createElement("style");
  el.textContent = STYLES;
  document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme", "dark");
}

// ── Color helpers ─────────────────────────────────────────────────────────
const C = {
  navy:    (o=1) => `rgba(var(--cu-navy),${o})`,
  steel:   (o=1) => `rgba(var(--cu-steel),${o})`,
  amber:   (o=1) => `rgba(var(--cu-amber),${o})`,
  linen:   (o=1) => `rgba(var(--cu-linen),${o})`,
  ok:      (o=1) => `rgba(var(--cu-ok),${o})`,
  ng:      (o=1) => `rgba(var(--cu-ng),${o})`,
  bg:      (v="card")    => `rgb(var(--cu-bg-${v}))`,
  txt:     (v="pri")     => `rgb(var(--cu-txt-${v}))`,
  border:  (o)           => `rgba(var(--cu-border),${o || "var(--cu-bop)"})`,
};

// ── Role config ───────────────────────────────────────────────────────────
const ROLES = [
  {
    id:    "Operator",
    label: "Operator",
    desc:  "Live dashboard, basic production tracking",
    icon:  HardHat,
    color: C.steel,
  },
  {
    id:    "Engineer",
    label: "Engineer",
    desc:  "PLC tuning, QR rules, I/O monitor",
    icon:  Wrench,
    color: C.amber,
  },
  {
    id:    "Admin",
    label: "Admin",
    desc:  "Full system control & user management",
    icon:  Shield,
    color: C.navy,
  },
];

// ── Password strength ─────────────────────────────────────────────────────
function getStrength(pw) {
  if (!pw) return { score: 0, label: "", color: "transparent" };
  let score = 0;
  if (pw.length >= 8)           score++;
  if (/[A-Z]/.test(pw))         score++;
  if (/[0-9]/.test(pw))         score++;
  if (/[^A-Za-z0-9]/.test(pw))  score++;
  const map = [
    { label: "Too short",  color: C.ng()    },
    { label: "Weak",       color: C.ng(0.7) },
    { label: "Fair",       color: C.amber() },
    { label: "Good",       color: C.steel() },
    { label: "Strong",     color: C.ok()    },
  ];
  return { score, ...map[score] };
}

// ─────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────
const CreateUser = () => {
  injectStyles();

  const [formData,     setFormData]     = useState({ username: "", password: "", role: "Operator" });
  const [status,       setStatus]       = useState({ type: "", message: "" });
  const [showPw,       setShowPw]       = useState(false);
  const [focusField,   setFocusField]   = useState("");
  const [shake,        setShake]        = useState(false);

  const strength = getStrength(formData.password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: "loading", message: "Creating user account…" });
    try {
      await axios.post(
        "http://localhost:4000/api/auth/register",
        formData,
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      setStatus({ type: "success", message: `User "${formData.username}" created successfully.` });
      setFormData({ username: "", password: "", role: "Operator" });
    } catch (err) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setStatus({ type: "error", message: err.response?.data?.error || "Failed to create user. Please try again." });
    }
  };

  const inputStyle = (field) => ({
    width: "100%",
    height: 44,
    padding: "0 14px",
    paddingLeft: 42,
    background: C.bg("input"),
    border: `1px solid ${focusField === field ? C.steel() : C.border()}`,
    borderRadius: 10,
    fontSize: 13,
    color: C.txt("pri"),
    outline: "none",
    fontFamily: "'DM Sans', sans-serif",
    transition: "border-color 0.15s, box-shadow 0.15s",
    boxSizing: "border-box",
    boxShadow: focusField === field ? `0 0 0 3px ${C.steel(0.1)}` : "none",
  });

  const selectedRole = ROLES.find(r => r.id === formData.role);

  return (
    <div style={{
      maxWidth: 560,
      margin: "0 auto",
      padding: "4px 2px",
      animation: "cuFadeIn 0.3s ease",
    }}>

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14, marginBottom: 24,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, flexShrink: 0,
          background: `linear-gradient(135deg,${C.navy()},${C.steel(0.85)})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 4px 14px ${C.navy(0.35)}`,
        }}>
          <UserPlus size={22} color={C.linen()} />
        </div>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: C.txt("pri"),
            letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            User Management
          </h1>
          <p style={{ fontSize: 12, color: C.txt("muted"), marginTop: 3 }}>
            Create and manage production floor access credentials
          </p>
        </div>
      </div>

      {/* ── Main card ────────────────────────────────────────────────── */}
      <div style={{
        background: C.bg("card"),
        border: `1px solid ${C.border()}`,
        borderRadius: 16,
        boxShadow: `0 4px 24px ${C.navy(0.12)}, 0 1px 4px ${C.navy(0.06)}`,
        overflow: "hidden",
        animation: shake ? "cuShake 0.4s ease" : "none",
      }}>

        {/* Top accent bar */}
        <div style={{
          height: 3,
          background: `linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,
        }}/>

        {/* Card header */}
        <div style={{
          padding: "16px 22px",
          borderBottom: `1px solid ${C.border()}`,
          background: C.bg("surface"),
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase",
              letterSpacing: "0.1em", color: C.txt("muted"), marginBottom: 2 }}>
              Access Control
            </p>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.txt("pri") }}>
              New User Account
            </p>
          </div>
          {/* Selected role preview pill */}
          {selectedRole && (() => {
            const RoleIcon = selectedRole.icon;
            return (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 99,
                background: selectedRole.color(0.1),
                border: `1px solid ${selectedRole.color(0.25)}`,
              }}>
                <RoleIcon size={13} color={selectedRole.color()} />
                <span style={{ fontSize: 11, fontWeight: 700,
                  color: selectedRole.color() }}>{selectedRole.label}</span>
              </div>
            );
          })()}
        </div>

        {/* Form body */}
        <div style={{ padding: "22px 22px 24px" }}>

          {/* Status banner */}
          {status.message && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "11px 14px", borderRadius: 10, marginBottom: 20,
              fontSize: 12, lineHeight: 1.5,
              background: status.type === "success" ? C.ok(0.08)
                : status.type === "error"   ? C.ng(0.08)
                : C.steel(0.08),
              border: `1px solid ${
                status.type === "success" ? C.ok(0.25)
                : status.type === "error" ? C.ng(0.25)
                : C.steel(0.25)}`,
              color: status.type === "success" ? C.ok()
                : status.type === "error"   ? C.ng()
                : C.steel(),
              animation: "cuFadeIn 0.2s ease",
            }}>
              {status.type === "success" && <UserCheck size={15} style={{ flexShrink: 0, marginTop: 1 }}/>}
              {status.type === "error"   && <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }}/>}
              {status.type === "loading" && (
                <Loader2 size={15} style={{ flexShrink: 0, marginTop: 1,
                  animation: "cuSpin 0.8s linear infinite" }}/>
              )}
              <span>{status.message}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* ── Username ── */}
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.07em", color: C.txt("sec"), marginBottom: 7 }}>
                <User size={11}/> Username
                <span style={{ color: C.ng(), marginLeft: 1 }}>*</span>
              </label>
              <div style={{ position: "relative" }}>
                <User size={14} color={focusField === "username" ? C.steel() : C.txt("muted")}
                  style={{ position: "absolute", left: 13, top: "50%",
                    transform: "translateY(-50%)", transition: "color 0.15s" }}/>
                <input
                  type="text"
                  placeholder="e.g. rahul.das"
                  value={formData.username}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                  onFocus={() => setFocusField("username")}
                  onBlur={() => setFocusField("")}
                  required
                  style={inputStyle("username")}
                />
              </div>
              <p style={{ fontSize: 11, color: C.txt("muted"), marginTop: 5, marginLeft: 1 }}>
                Used to log in to the IndusTrace system
              </p>
            </div>

            {/* ── Password ── */}
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.07em", color: C.txt("sec"), marginBottom: 7 }}>
                <Lock size={11}/> Password
                <span style={{ color: C.ng(), marginLeft: 1 }}>*</span>
              </label>
              <div style={{ position: "relative" }}>
                <Lock size={14} color={focusField === "password" ? C.steel() : C.txt("muted")}
                  style={{ position: "absolute", left: 13, top: "50%",
                    transform: "translateY(-50%)", transition: "color 0.15s" }}/>
                <input
                  type={showPw ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  onFocus={() => setFocusField("password")}
                  onBlur={() => setFocusField("")}
                  required
                  style={{ ...inputStyle("password"), paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  style={{
                    position: "absolute", right: 12, top: "50%",
                    transform: "translateY(-50%)", background: "none",
                    border: "none", cursor: "pointer", color: C.txt("muted"),
                    display: "flex", alignItems: "center", padding: 4,
                  }}>
                  {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>

              {/* Strength meter */}
              {formData.password && (
                <div style={{ marginTop: 8, animation: "cuFadeIn 0.2s ease" }}>
                  <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} style={{
                        flex: 1, height: 3, borderRadius: 99,
                        background: i <= strength.score ? strength.color : C.border(),
                        transition: "background 0.25s ease",
                      }}/>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: strength.color, fontWeight: 600 }}>
                    {strength.label}
                  </p>
                </div>
              )}
            </div>

            {/* ── Role selector ── */}
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.07em", color: C.txt("sec"), marginBottom: 7 }}>
                <Shield size={11}/> Access Level
                <span style={{ color: C.ng(), marginLeft: 1 }}>*</span>
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ROLES.map(role => {
                  const active = formData.role === role.id;
                  const RIcon  = role.icon;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, role: role.id })}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        width: "100%", padding: "12px 14px",
                        background: active ? role.color(0.08) : C.bg("input"),
                        border: `1px solid ${active ? role.color(0.4) : C.border()}`,
                        borderRadius: 10, cursor: "pointer",
                        transition: "all 0.15s ease",
                        outline: "none", textAlign: "left",
                        boxShadow: active ? `0 0 0 3px ${role.color(0.1)}` : "none",
                      }}>

                      {/* Role icon */}
                      <div style={{
                        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                        background: role.color(active ? 0.15 : 0.07),
                        border: `1px solid ${role.color(active ? 0.35 : 0.15)}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s",
                      }}>
                        <RIcon size={17} color={role.color(active ? 1 : 0.6)}/>
                      </div>

                      {/* Role text */}
                      <div style={{ flex: 1 }}>
                        <p style={{
                          fontSize: 13, fontWeight: 700,
                          color: active ? role.color() : C.txt("pri"),
                          marginBottom: 2,
                        }}>{role.label}</p>
                        <p style={{ fontSize: 11, color: C.txt("muted"), lineHeight: 1.4 }}>
                          {role.desc}
                        </p>
                      </div>

                      {/* Active check */}
                      <div style={{
                        width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                        background: active ? role.color() : "transparent",
                        border: `2px solid ${active ? role.color() : C.border()}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s",
                      }}>
                        {active && (
                          <svg width="9" height="9" viewBox="0 0 9 9">
                            <polyline points="1.5,4.5 3.5,6.5 7.5,2.5"
                              fill="none" stroke={C.bg("card")} strokeWidth="1.8"
                              strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Divider ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
              <div style={{ flex: 1, height: 1, background: C.border() }}/>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.txt("muted"),
                textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Review &amp; Submit
              </span>
              <div style={{ flex: 1, height: 1, background: C.border() }}/>
            </div>

            {/* ── Summary row ── */}
            {(formData.username || formData.role) && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", borderRadius: 10,
                background: C.bg("surface"), border: `1px solid ${C.border()}`,
                animation: "cuFadeIn 0.2s ease",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: C.navy(0.12), border: `1px solid ${C.navy(0.2)}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <User size={14} color={C.steel()}/>
                  </div>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: C.txt("pri"),
                      fontFamily: "'DM Mono',monospace" }}>
                      {formData.username || "—"}
                    </p>
                    <p style={{ fontSize: 10, color: C.txt("muted"), marginTop: 1 }}>
                      {formData.role} · IndusTrace MES
                    </p>
                  </div>
                </div>
                <ChevronRight size={14} color={C.txt("muted")}/>
              </div>
            )}

            {/* ── Submit button ── */}
            <button
              type="submit"
              disabled={status.type === "loading"}
              style={{
                width: "100%", height: 46,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                background: status.type === "loading"
                  ? C.amber(0.7)
                  : C.amber(),
                border: "none", borderRadius: 11,
                fontSize: 13, fontWeight: 800,
                color: C.navy(),
                letterSpacing: "0.04em",
                cursor: status.type === "loading" ? "not-allowed" : "pointer",
                boxShadow: `0 4px 16px ${C.amber(0.3)}`,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { if (status.type !== "loading") e.currentTarget.style.filter = "brightness(1.07)"; }}
              onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
            >
              {status.type === "loading" ? (
                <>
                  <Loader2 size={16} style={{ animation: "cuSpin 0.8s linear infinite" }}/>
                  Creating Account…
                </>
              ) : (
                <>
                  <ShieldPlus size={16}/>
                  Create User Account
                </>
              )}
            </button>

          </form>
        </div>
      </div>

      {/* ── Permission reference card ──────────────────────────────── */}
      <div style={{
        marginTop: 16,
        background: C.bg("card"),
        border: `1px solid ${C.border()}`,
        borderRadius: 14,
        overflow: "hidden",
      }}>
        <div style={{
          padding: "12px 18px",
          borderBottom: `1px solid ${C.border()}`,
          background: C.bg("surface"),
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.txt("muted"),
            textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Access Level Reference
          </p>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { role: "Operator",  color: C.steel, perms: ["Live Dashboard", "Basic Production Tracking"] },
            { role: "Engineer",  color: C.amber, perms: ["PLC Configuration", "QR Rules", "I/O Monitor", "Device Registry"] },
            { role: "Admin",     color: C.navy,  perms: ["All Engineer Permissions", "User Management", "System Settings"] },
          ].map(({ role, color, perms }) => (
            <div key={role} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: color(), flexShrink: 0, marginTop: 5,
              }}/>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: color(), marginBottom: 3 }}>
                  {role}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {perms.map(p => (
                    <span key={p} style={{
                      fontSize: 10, fontWeight: 600,
                      padding: "2px 8px", borderRadius: 5,
                      background: color(0.08),
                      border: `1px solid ${color(0.2)}`,
                      color: color(0.85),
                    }}>{p}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default CreateUser;

