// ============================================================
//  LoginPage.jsx — IndusTrace Premium Industrial Login
//  - Industrial SVG background (factory floor grid + nodes)
//  - Navy / Steel / Amber / Linen color theme
//  - Clean professional language
//  - Dark + Light support via [data-theme]
// ============================================================
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, Lock, User, Eye, EyeOff,
  AlertCircle, RefreshCw, Cpu, Activity,
  GitBranch, CheckCircle2,
} from "lucide-react";
import toast from "react-hot-toast";
import { authApi } from "../api/services";
import { setAuthSession } from "../utils/authStorage";
import { APP_ROUTES } from "../constants/routes";

// ── Styles injected once ──────────────────────────────────────────────────
const STYLES = `
  @keyframes lpSpin    { to{transform:rotate(360deg)} }
  @keyframes lpFadeUp  { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
  @keyframes lpPulse   { 0%,100%{opacity:.6} 50%{opacity:1} }
  @keyframes lpPing    { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.2);opacity:0} }
  @keyframes lpDrift   { 0%{transform:translateY(0px)} 50%{transform:translateY(-8px)} 100%{transform:translateY(0px)} }
  @keyframes lpFlow    { 0%{stroke-dashoffset:200} 100%{stroke-dashoffset:0} }
  @keyframes lpShake   { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-4px)} 40%,80%{transform:translateX(4px)} }

  :root{
    --lp-navy:  26,50,99;
    --lp-steel: 84,119,146;
    --lp-amber: 250,185,91;
    --lp-linen: 232,226,219;
    --lp-ok:    34,197,94;
    --lp-ng:    239,68,68;
  }
  [data-theme="light"]{
    --lp-bg:      240,236,230;
    --lp-card:    255,255,255;
    --lp-surf:    248,246,243;
    --lp-input:   255,255,255;
    --lp-txt-pri: 26,50,99;
    --lp-txt-sec: 84,119,146;
    --lp-txt-m:   140,160,180;
    --lp-bdr:     84,119,146;
    --lp-bop:     0.15;
  }
  [data-theme="dark"]{
    --lp-bg:      10,18,36;
    --lp-card:    20,34,62;
    --lp-surf:    16,26,50;
    --lp-input:   14,22,44;
    --lp-txt-pri: 232,226,219;
    --lp-txt-sec: 120,160,190;
    --lp-txt-m:   84,119,146;
    --lp-bdr:     84,119,146;
    --lp-bop:     0.18;
  }
`;
let _lp = false;
function injectLP() {
  if (_lp || typeof document === "undefined") return;
  _lp = true;
  const el = document.createElement("style");
  el.textContent = STYLES;
  document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme", "dark");
}

// ── Color helpers ─────────────────────────────────────────────────────────
const C = {
  navy:  (o=1) => `rgba(var(--lp-navy),${o})`,
  steel: (o=1) => `rgba(var(--lp-steel),${o})`,
  amber: (o=1) => `rgba(var(--lp-amber),${o})`,
  linen: (o=1) => `rgba(var(--lp-linen),${o})`,
  ok:    (o=1) => `rgba(var(--lp-ok),${o})`,
  ng:    (o=1) => `rgba(var(--lp-ng),${o})`,
  bg:    (v="bg")    => `rgb(var(--lp-${v}))`,
  txt:   (v="pri")   => `rgb(var(--lp-txt-${v}))`,
  bdr:   (o)         => `rgba(var(--lp-bdr),${o||"var(--lp-bop)"})`,
};

// ── Industrial SVG Background ─────────────────────────────────────────────
// Represents a factory floor schematic — machines, conveyor lines, stations
const IndustrialBg = () => (
  <svg
    viewBox="0 0 1200 700"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      position:"absolute", inset:0,
      width:"100%", height:"100%",
      opacity:0.13,
    }}
    preserveAspectRatio="xMidYMid slice"
  >
    <defs>
      <marker id="arr" viewBox="0 0 8 8" refX="6" refY="4"
        markerWidth="5" markerHeight="5" orient="auto">
        <path d="M1 1L7 4L1 7" fill="none"
          stroke="rgba(84,119,146,1)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"/>
      </marker>
    </defs>

    {/* ── Background grid ── */}
    {Array.from({length:30}).map((_,i)=>(
      <line key={`h${i}`} x1="0" y1={i*25} x2="1200" y2={i*25}
        stroke="rgba(84,119,146,0.4)" strokeWidth="0.4"/>
    ))}
    {Array.from({length:50}).map((_,i)=>(
      <line key={`v${i}`} x1={i*25} y1="0" x2={i*25} y2="700"
        stroke="rgba(84,119,146,0.4)" strokeWidth="0.4"/>
    ))}

    {/* ── Main conveyor lines ── */}
    {/* Top conveyor */}
    <line x1="60" y1="150" x2="1140" y2="150"
      stroke="rgba(84,119,146,0.9)" strokeWidth="2.5"
      strokeDasharray="8 4" markerEnd="url(#arr)"/>
    {/* Middle conveyor */}
    <line x1="60" y1="350" x2="1140" y2="350"
      stroke="rgba(84,119,146,0.9)" strokeWidth="2.5"
      strokeDasharray="8 4" markerEnd="url(#arr)"/>
    {/* Bottom conveyor */}
    <line x1="1140" y1="550" x2="60" y2="550"
      stroke="rgba(84,119,146,0.9)" strokeWidth="2.5"
      strokeDasharray="8 4" markerEnd="url(#arr)"/>

    {/* Vertical connectors between conveyors */}
    <line x1="200" y1="150" x2="200" y2="350"
      stroke="rgba(84,119,146,0.7)" strokeWidth="1.5" markerEnd="url(#arr)"/>
    <line x1="500" y1="150" x2="500" y2="350"
      stroke="rgba(84,119,146,0.7)" strokeWidth="1.5" markerEnd="url(#arr)"/>
    <line x1="800" y1="150" x2="800" y2="350"
      stroke="rgba(84,119,146,0.7)" strokeWidth="1.5" markerEnd="url(#arr)"/>
    <line x1="1050" y1="350" x2="1050" y2="550"
      stroke="rgba(84,119,146,0.7)" strokeWidth="1.5" markerEnd="url(#arr)"/>
    <line x1="350" y1="350" x2="350" y2="550"
      stroke="rgba(84,119,146,0.7)" strokeWidth="1.5" markerEnd="url(#arr)"/>

    {/* ── Machine station boxes — top conveyor ── */}
    {[120, 320, 520, 720, 920, 1080].map((x,i)=>(
      <g key={`mt${i}`}>
        <rect x={x-40} y="100" width="80" height="50" rx="6"
          fill="rgba(26,50,99,0.6)" stroke="rgba(84,119,146,0.9)" strokeWidth="1.5"/>
        {/* Station label */}
        <text x={x} y="121" textAnchor="middle"
          fontSize="8" fontWeight="700" fill="rgba(84,119,146,1)"
          fontFamily="monospace" letterSpacing="0.5">
          {`OP-${String(i+1).padStart(2,"0")}`}
        </text>
        {/* Inner detail lines */}
        <line x1={x-28} y1="130" x2={x+28} y2="130"
          stroke="rgba(84,119,146,0.5)" strokeWidth="0.8"/>
        <rect x={x-20} y="133" width="12" height="10" rx="2"
          fill="none" stroke="rgba(84,119,146,0.6)" strokeWidth="1"/>
        <rect x={x-4} y="133" width="8" height="10" rx="2"
          fill="none" stroke="rgba(84,119,146,0.6)" strokeWidth="1"/>
        <rect x={x+8} y="133" width="12" height="10" rx="2"
          fill="none" stroke="rgba(84,119,146,0.6)" strokeWidth="1"/>
        {/* Status dot */}
        <circle cx={x+32} cy={i%2===0?108:138} r="5"
          fill={i%3===0?"rgba(34,197,94,0.7)":i%3===1?"rgba(250,185,91,0.7)":"rgba(34,197,94,0.7)"}/>
      </g>
    ))}

    {/* ── Machine station boxes — middle conveyor ── */}
    {[200, 400, 600, 800, 1000].map((x,i)=>(
      <g key={`mm${i}`}>
        <rect x={x-45} y="300" width="90" height="55" rx="6"
          fill="rgba(26,50,99,0.6)" stroke="rgba(84,119,146,0.8)" strokeWidth="1.5"/>
        <text x={x} y="320" textAnchor="middle"
          fontSize="8" fontWeight="700" fill="rgba(84,119,146,1)"
          fontFamily="monospace" letterSpacing="0.5">
          {`ST-${String(i+10).padStart(2,"0")}`}
        </text>
        <line x1={x-33} y1="328" x2={x+33} y2="328"
          stroke="rgba(84,119,146,0.5)" strokeWidth="0.8"/>
        {/* Gear icon simplified */}
        <circle cx={x} cy="340" r="8"
          fill="none" stroke="rgba(84,119,146,0.5)" strokeWidth="1.2"/>
        <circle cx={x} cy="340" r="3"
          fill="rgba(84,119,146,0.4)"/>
        {[0,45,90,135,180,225,270,315].map((deg,d)=>{
          const rad=deg*Math.PI/180;
          return <line key={d}
            x1={x+5.5*Math.cos(rad)} y1={340+5.5*Math.sin(rad)}
            x2={x+9*Math.cos(rad)}   y2={340+9*Math.sin(rad)}
            stroke="rgba(84,119,146,0.5)" strokeWidth="1.2"/>;
        })}
        <circle cx={x+36} cy={308} r="5"
          fill={i%2===0?"rgba(34,197,94,0.7)":"rgba(250,185,91,0.6)"}/>
      </g>
    ))}

    {/* ── Bottom conveyor machines (return line) ── */}
    {[900, 650, 400, 150].map((x,i)=>(
      <g key={`mb${i}`}>
        <rect x={x-35} y="520" width="70" height="45" rx="5"
          fill="rgba(26,50,99,0.55)" stroke="rgba(84,119,146,0.7)" strokeWidth="1.2"/>
        <text x={x} y="538" textAnchor="middle"
          fontSize="7" fontWeight="700" fill="rgba(84,119,146,0.9)"
          fontFamily="monospace">
          {`QC-${String(i+1).padStart(2,"0")}`}
        </text>
        <rect x={x-22} y="542" width="16" height="16" rx="2"
          fill="none" stroke="rgba(84,119,146,0.5)" strokeWidth="1"/>
        {/* QR-like pattern */}
        <rect x={x-20} y="544" width="4" height="4" fill="rgba(84,119,146,0.5)"/>
        <rect x={x-14} y="544" width="4" height="4" fill="rgba(84,119,146,0.5)"/>
        <rect x={x-20} y="550" width="4" height="4" fill="rgba(84,119,146,0.5)"/>
        <rect x={x+4} y="542" width="16" height="16" rx="2"
          fill="none" stroke="rgba(84,119,146,0.5)" strokeWidth="1"/>
        <circle cx={x+36} cy={528} r="4"
          fill={i%2===0?"rgba(34,197,94,0.6)":"rgba(239,68,68,0.5)"}/>
      </g>
    ))}

    {/* ── PLC controller boxes (corners) ── */}
    {[[40,60],[1100,60],[40,600],[1100,600]].map(([x,y],i)=>(
      <g key={`plc${i}`}>
        <rect x={x-30} y={y-25} width="60" height="50" rx="5"
          fill="rgba(26,50,99,0.7)" stroke="rgba(84,119,146,0.9)" strokeWidth="1.5"/>
        <text x={x} y={y-10} textAnchor="middle"
          fontSize="6" fontWeight="800" fill="rgba(84,119,146,1)"
          fontFamily="monospace" letterSpacing="1">PLC</text>
        <line x1={x-18} y1={y-2} x2={x+18} y2={y-2}
          stroke="rgba(84,119,146,0.5)" strokeWidth="0.8"/>
        {[-12,-4,4,12].map((dx,j)=>(
          <rect key={j} x={x+dx-3} y={y+2} width="6" height="14" rx="1"
            fill={j===0?"rgba(34,197,94,0.5)":j===1?"rgba(250,185,91,0.5)":
              j===2?"rgba(84,119,146,0.4)":"rgba(26,50,99,0.4)"}
            stroke="rgba(84,119,146,0.4)" strokeWidth="0.6"/>
        ))}
      </g>
    ))}

    {/* ── Data flow lines from PLCs ── */}
    <path d="M70 60 Q120 60 120 100"
      fill="none" stroke="rgba(84,119,146,0.5)" strokeWidth="1"
      strokeDasharray="4 3"/>
    <path d="M1070 60 Q1050 60 1050 100"
      fill="none" stroke="rgba(84,119,146,0.5)" strokeWidth="1"
      strokeDasharray="4 3"/>

    {/* ── Part flow indicator dots ── */}
    {[160,260,360,460,560,660,760,860,960].map((x,i)=>(
      <circle key={`dot${i}`} cx={x} cy="150" r="5"
        fill={i%4===0?"rgba(250,185,91,0.8)":"rgba(84,119,146,0.5)"}/>
    ))}
    {[240,440,640,840].map((x,i)=>(
      <circle key={`dot2${i}`} cx={x} cy="350" r="5"
        fill={i%3===0?"rgba(34,197,94,0.7)":"rgba(84,119,146,0.4)"}/>
    ))}

    {/* ── Legend labels ── */}
    <text x="60" y="680" fontSize="9" fill="rgba(84,119,146,0.7)"
      fontFamily="monospace" fontWeight="600">
      PRESS ZONE A
    </text>
    <text x="380" y="680" fontSize="9" fill="rgba(84,119,146,0.7)"
      fontFamily="monospace" fontWeight="600">
      ASSEMBLY LINE B
    </text>
    <text x="700" y="680" fontSize="9" fill="rgba(84,119,146,0.7)"
      fontFamily="monospace" fontWeight="600">
      TEST & INSPECT
    </text>
    <text x="980" y="680" fontSize="9" fill="rgba(84,119,146,0.7)"
      fontFamily="monospace" fontWeight="600">
      PACK & LABEL
    </text>

    {/* horizontal zone dividers */}
    <line x1="340" y1="640" x2="340" y2="670"
      stroke="rgba(84,119,146,0.4)" strokeWidth="1"/>
    <line x1="660" y1="640" x2="660" y2="670"
      stroke="rgba(84,119,146,0.4)" strokeWidth="1"/>
    <line x1="960" y1="640" x2="960" y2="670"
      stroke="rgba(84,119,146,0.4)" strokeWidth="1"/>
  </svg>
);

// ═══════════════════════════════════════════════════════════════════════════
//  LOGIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
const LoginPage = () => {
  injectLP();

  const navigate  = useNavigate();
  const [form,    setForm]    = useState({ username:"", password:"" });
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [shake,   setShake]   = useState(false);
  const [focusF,  setFocusF]  = useState("");

  // Animated live stats (cosmetic)
  const [stats] = useState({
    machines: 12, online: 10, parts: 248, efficiency: 94,
  });

  const handleSubmit = async(e) => {
    e.preventDefault();
    if (!form.username || !form.password) {
      toast.error("Please enter your username and password.");
      return;
    }
    setLoading(true); setError(null);
    try {
      const res = await authApi.login(form);
      setAuthSession({ token: res.token, user: res.user });
      toast.success(`Welcome back, ${res.user.username}`);
      navigate(APP_ROUTES.dashboard);
    } catch(err) {
      setShake(true);
      setTimeout(()=>setShake(false), 500);
      setError(err.response?.data?.error || "Invalid username or password. Please try again.");
      toast.error("Login failed");
    } finally { setLoading(false); }
  };

  const inputStyle = (f) => ({
    width:"100%", height:46,
    paddingLeft:44, paddingRight:f==="password"?44:14,
    background:`rgb(var(--lp-input))`,
    border:`1px solid ${focusF===f ? C.steel() : C.bdr()}`,
    borderRadius:10, fontSize:13,
    color:C.txt("pri"), outline:"none",
    fontFamily:"'DM Sans',sans-serif",
    transition:"border-color .15s,box-shadow .15s",
    boxShadow:focusF===f?`0 0 0 3px ${C.steel(0.12)}`:"none",
    boxSizing:"border-box",
  });

  return (
    <div style={{
      minHeight:"100vh",
      background:`rgb(var(--lp-bg))`,
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:16, position:"relative", overflow:"hidden",
      fontFamily:"'DM Sans',sans-serif",
    }}>
      {/* ── Industrial SVG Background ── */}
      <IndustrialBg/>

      {/* ── Ambient color blobs ── */}
      <div style={{
        position:"absolute",top:"-15%",left:"-10%",
        width:"45%",height:"45%",borderRadius:"50%",
        background:C.navy(0.35),filter:"blur(100px)",
        pointerEvents:"none",
      }}/>
      <div style={{
        position:"absolute",bottom:"-15%",right:"-10%",
        width:"40%",height:"40%",borderRadius:"50%",
        background:C.steel(0.2),filter:"blur(90px)",
        pointerEvents:"none",
      }}/>
      <div style={{
        position:"absolute",top:"40%",right:"15%",
        width:"20%",height:"20%",borderRadius:"50%",
        background:C.amber(0.08),filter:"blur(60px)",
        pointerEvents:"none",
      }}/>

      {/* ── Main container ── */}
      <div style={{
        width:"100%", maxWidth:460, zIndex:10,
        animation:"lpFadeUp 0.4s ease",
      }}>

        {/* ── Logo & brand ── */}
        <div style={{textAlign:"center",marginBottom:28}}>
          {/* Logo mark */}
          <div style={{
            width:64,height:64,borderRadius:18,margin:"0 auto 16px",
            background:`linear-gradient(135deg,${C.navy()},${C.steel(0.9)})`,
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:`0 8px 28px ${C.navy(0.5)},0 0 0 1px ${C.steel(0.3)}`,
            animation:"lpDrift 4s ease-in-out infinite",
            position:"relative",
          }}>
            {/* Ping ring */}
            <div style={{position:"absolute",inset:0,borderRadius:18,
              border:`2px solid ${C.steel(0.4)}`,
              animation:"lpPulse 2s ease-in-out infinite"}}/>
            <ShieldCheck size={30} color={C.linen()}/>
          </div>

          <h1 style={{
            fontSize:28,fontWeight:900,letterSpacing:"-0.03em",
            lineHeight:1.1,marginBottom:6,
            color:C.txt("pri"),
          }}>
            Indus<span style={{color:C.amber(),fontStyle:"italic"}}>Trace</span>
          </h1>

          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:4}}>
            <div style={{height:1,width:28,background:C.bdr()}}/>
            <p style={{fontSize:10,fontWeight:700,textTransform:"uppercase",
              letterSpacing:"0.15em",color:C.txt("m")}}>
              Manufacturing Traceability System
            </p>
            <div style={{height:1,width:28,background:C.bdr()}}/>
          </div>
        </div>

      

        {/* ── Login card ── */}
        <div style={{
          background:C.bg("card"),
          border:`1px solid ${C.bdr()}`,
          borderRadius:18,
          boxShadow:`0 20px 60px ${C.navy(0.4)},0 4px 16px ${C.navy(0.2)}`,
          overflow:"hidden",
          animation:shake?"lpShake 0.4s ease":"none",
        }}>
          {/* Top accent */}
          <div style={{height:3,
            background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>

          {/* Card header */}
          <div style={{
            padding:"18px 24px 14px",
            borderBottom:`1px solid ${C.bdr()}`,
            background:C.bg("surf"),
            display:"flex",alignItems:"center",justifyContent:"space-between",
          }}>
            <div>
              <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                letterSpacing:"0.12em",color:C.txt("m"),marginBottom:3}}>
                Secure Access
              </p>
              <p style={{fontSize:14,fontWeight:700,color:C.txt("pri")}}>
                Sign in to your account
              </p>
            </div>
            {/* Live indicator */}
            <div style={{display:"flex",alignItems:"center",gap:6,
              padding:"5px 10px",borderRadius:99,
              background:C.ok(0.1),border:`1px solid ${C.ok(0.25)}`}}>
              <div style={{position:"relative",width:6,height:6}}>
                <div style={{position:"absolute",inset:0,borderRadius:"50%",
                  background:C.ok(),animation:"lpPing 1.6s ease-out infinite",opacity:0.6}}/>
                <div style={{width:6,height:6,borderRadius:"50%",background:C.ok()}}/>
              </div>
              <span style={{fontSize:10,fontWeight:700,color:C.ok()}}>System Online</span>
            </div>
          </div>

          {/* Form */}
          <div style={{padding:"22px 24px 24px"}}>

            {/* Error */}
            {error && (
              <div style={{
                display:"flex",alignItems:"flex-start",gap:9,
                padding:"11px 14px",borderRadius:9,marginBottom:18,
                background:C.ng(0.08),border:`1px solid ${C.ng(0.25)}`,
                animation:"lpFadeUp .2s ease",
              }}>
                <AlertCircle size={14} color={C.ng()} style={{flexShrink:0,marginTop:1}}/>
                <p style={{fontSize:12,color:C.ng(),fontWeight:600,lineHeight:1.4}}>
                  {error}
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit}
              style={{display:"flex",flexDirection:"column",gap:16}}>

              {/* Username */}
              <div>
                <p style={{fontSize:10,fontWeight:700,textTransform:"uppercase",
                  letterSpacing:"0.07em",color:C.txt("sec"),marginBottom:6,
                  display:"flex",alignItems:"center",gap:4}}>
                  <User size={10}/> Username
                  <span style={{color:C.ng()}}>*</span>
                </p>
                <div style={{position:"relative"}}>
                  <User size={15} color={focusF==="username"?C.steel():C.txt("m")}
                    style={{position:"absolute",left:14,top:"50%",
                      transform:"translateY(-50%)",transition:"color .15s"}}/>
                  <input type="text" required
                    value={form.username}
                    onChange={e=>setForm(p=>({...p,username:e.target.value}))}
                    placeholder="Enter your username"
                    onFocus={()=>setFocusF("username")}
                    onBlur={()=>setFocusF("")}
                    style={inputStyle("username")}
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <p style={{fontSize:10,fontWeight:700,textTransform:"uppercase",
                  letterSpacing:"0.07em",color:C.txt("sec"),marginBottom:6,
                  display:"flex",alignItems:"center",gap:4}}>
                  <Lock size={10}/> Password
                  <span style={{color:C.ng()}}>*</span>
                </p>
                <div style={{position:"relative"}}>
                  <Lock size={15} color={focusF==="password"?C.steel():C.txt("m")}
                    style={{position:"absolute",left:14,top:"50%",
                      transform:"translateY(-50%)",transition:"color .15s"}}/>
                  <input type={showPw?"text":"password"} required
                    value={form.password}
                    onChange={e=>setForm(p=>({...p,password:e.target.value}))}
                    placeholder="Enter your password"
                    onFocus={()=>setFocusF("password")}
                    onBlur={()=>setFocusF("")}
                    style={inputStyle("password")}
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={()=>setShowPw(p=>!p)}
                    style={{
                      position:"absolute",right:12,top:"50%",
                      transform:"translateY(-50%)",background:"none",
                      border:"none",cursor:"pointer",color:C.txt("m"),
                      display:"flex",alignItems:"center",padding:4,
                    }}>
                    {showPw?<EyeOff size={15}/>:<Eye size={15}/>}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button type="submit" disabled={loading}
                style={{
                  width:"100%",height:48,marginTop:4,
                  display:"flex",alignItems:"center",justifyContent:"center",gap:9,
                  background:loading ? C.amber(0.7) : C.amber(),
                  border:"none",borderRadius:11,
                  fontSize:13,fontWeight:800,
                  color:C.navy(),letterSpacing:"0.02em",
                  cursor:loading?"not-allowed":"pointer",
                  boxShadow:`0 4px 20px ${C.amber(0.35)}`,
                  transition:"filter .15s",
                  opacity:loading?0.8:1,
                }}
                onMouseEnter={e=>{ if(!loading) e.currentTarget.style.filter="brightness(1.07)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.filter="none"; }}>
                {loading ? (
                  <>
                    <RefreshCw size={16}
                      style={{animation:"lpSpin .8s linear infinite"}}/>
                    Signing in…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16}/> Sign In
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* ── Feature badges ── */}
        <div style={{
          display:"flex",alignItems:"center",justifyContent:"center",
          gap:20,marginTop:22,flexWrap:"wrap",
        }}>
          {[
            { icon:Activity,    label:"Real-time Monitoring" },
            { icon:GitBranch,   label:"Part Genealogy"       },
            { icon:CheckCircle2,label:"QR Traceability"      },
            { icon:Cpu,         label:"PLC Integration"      },
          ].map(({icon:Icon,label},i)=>(
            <div key={i} style={{
              display:"flex",alignItems:"center",gap:5,
              fontSize:10,fontWeight:600,color:C.txt("m"),
            }}>
              <Icon size={12} color={C.steel()}/>
              {label}
            </div>
          ))}
        </div>

        
      </div>
    </div>
  );
};

export default LoginPage;


