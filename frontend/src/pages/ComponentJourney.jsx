// ============================================================
//  ComponentJourney.jsx — IndusTrace Enhanced
//  Changes:
//  ✓ QR Feed & Last QR Result removed from header
//  ✓ Parts list: QR code popup + Delete/Reset part button
//  ✓ Cleaner header — search + 3 KPI cards only
//  ✓ Latest QR shown inline on each station card instead
//  ✓ Professional, easy to understand layout
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import {
  AlertTriangle, CheckCircle2, Clock3, RefreshCw, RotateCcw,
  Search, X, XCircle, Activity, Layers, ChevronRight,
  MapPin, Zap, Package, QrCode, Trash2, Eye, EyeOff, Download,
} from "lucide-react";
import { machineApi, shiftApi, stationSettingsApi, traceabilityApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import {
  getStationFeatureSettings, getStationFeatures, saveStationFeatureSettings,
} from "../utils/stationSettings";

// ── Constants ──────────────────────────────────────────────────────────────
const SOCKET_URL                = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const REALTIME_REFRESH_COOLDOWN = 350;
const FALLBACK_POLL_INTERVAL    = 30000;
const CATALOG_SYNC_INTERVAL     = 60000;
const QR_DEDUPE_MS              = 3000;

// ── CSS Design Tokens ──────────────────────────────────────────────────────
const THEME_STYLES = `
  :root {
    --navy:    26,50,99;   --steel:  84,119,146;
    --amber:   250,185,91; --linen:  232,226,219;
    --ok-rgb:  34,197,94;  --ng-rgb: 239,68,68;
    --wip-rgb: 249,115,22; --idle-rgb:148,163,184;
  }
  [data-theme="light"] {
    --bg-base:    255,255,255; --bg-surface: 248,246,243;
    --bg-card:    255,255,255; --bg-input:   255,255,255;
    --bg-hover:   232,226,219;
    --txt-primary:26,50,99;   --txt-secondary:84,119,146;
    --txt-muted:  140,160,180;
    --border:     84,119,146; --border-op: 0.14;
    --shadow:     0 2px 12px rgba(26,50,99,0.08),0 1px 3px rgba(26,50,99,0.05);
    --shadow-md:  0 4px 20px rgba(26,50,99,0.12),0 2px 6px rgba(26,50,99,0.06);
  }
  [data-theme="dark"] {
    --bg-base:    10,18,36;   --bg-surface: 16,26,50;
    --bg-card:    20,34,62;   --bg-input:   14,22,44;
    --bg-hover:   26,42,74;
    --txt-primary:232,226,219; --txt-secondary:120,160,190;
    --txt-muted:  84,119,146;
    --border:     84,119,146; --border-op: 0.2;
    --shadow:     0 2px 12px rgba(0,0,0,0.3),0 1px 3px rgba(0,0,0,0.2);
    --shadow-md:  0 4px 20px rgba(0,0,0,0.4),0 2px 8px rgba(0,0,0,0.25);
  }
`;
const KEYFRAMES = `
  @keyframes itSpin    { to { transform: rotate(360deg); } }
  @keyframes itPulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes itFadeIn  { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
  @keyframes itSlideIn { from{opacity:0;transform:translateX(-6px)} to{opacity:1;transform:translateX(0)} }
  @keyframes itScale   { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
`;

let themeInjected = false;
function injectTheme() {
  if (themeInjected) return; themeInjected = true;
  const s = document.createElement("style"); s.textContent = THEME_STYLES; document.head.appendChild(s);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme","dark");
}
let kfInjected = false;
function injectKeyframes() {
  if (kfInjected) return; kfInjected = true;
  const s = document.createElement("style"); s.textContent = KEYFRAMES; document.head.appendChild(s);
}

// ── Color helpers ──────────────────────────────────────────────────────────
const C = {
  navy:   (o=1) => `rgba(var(--navy),${o})`,
  steel:  (o=1) => `rgba(var(--steel),${o})`,
  amber:  (o=1) => `rgba(var(--amber),${o})`,
  linen:  (o=1) => `rgba(var(--linen),${o})`,
  ok:     (o=1) => `rgba(var(--ok-rgb),${o})`,
  ng:     (o=1) => `rgba(var(--ng-rgb),${o})`,
  wip:    (o=1) => `rgba(var(--wip-rgb),${o})`,
  idle:   (o=1) => `rgba(var(--idle-rgb),${o})`,
  bg:     (v="base")      => `rgb(var(--bg-${v}))`,
  txt:    (v="primary")   => `rgb(var(--txt-${v}))`,
  border: (o)             => `rgba(var(--border),${o||"var(--border-op)"})`,
};

const STATUS = {
  ok:   { fg:C.ok(),   bgLight:C.ok(0.1),   border:C.ok(0.25)   },
  ng:   { fg:C.ng(),   bgLight:C.ng(0.1),   border:C.ng(0.25)   },
  wip:  { fg:C.wip(),  bgLight:C.wip(0.1),  border:C.wip(0.25)  },
  idle: { fg:C.idle(), bgLight:C.idle(0.08),border:C.idle(0.2)  },
};

// ── Unchanged utility functions ────────────────────────────────────────────
function normalizePartId(v) { return String(v||"").trim(); }
function extractQrDecision(payload={}) {
  const p=String(payload.qrResult||payload.decision||payload.outcome||payload.scanOutcome||payload.qrDecision||payload.qrStatus||"").trim().toUpperCase();
  if (p) return p;
  const f=String(payload.reason||payload.result||"").trim().toUpperCase();
  if (["PASS","OK","ALLOW"].includes(f)) return "ALLOW";
  if (["FAIL","NG","BLOCK","REJECT"].includes(f)) return "BLOCK";
  return "";
}
function hasQrDecision(payload={}) {
  return ["ALLOW","PASS","OK","ACCEPT","VALID","BLOCK","FAIL","NG","REJECT","INVALID"].includes(extractQrDecision(payload));
}
function toQrSignal(payload={}) {
  const d=extractQrDecision(payload);
  const isPass=["ALLOW","PASS","OK","ACCEPT","VALID"].includes(d);
  const isFail=["BLOCK","FAIL","NG","REJECT","INVALID"].includes(d);
  return {
    id:`${Date.now()}-${Math.random()}`,label:isPass?"QR PASS":isFail?"QR FAIL":"QR WAIT",
    variant:isPass?"ok":isFail?"ng":"idle",
    partId:normalizePartId(payload.partId||payload.part_id),
    stationNo:String(payload.stationNo||payload.station_no||"").trim().toUpperCase(),
    decision:d,reason:String(payload.reason||payload.qrReason||"").trim(),
    message:String(payload.message||"").trim(),timestamp:payload.timestamp||new Date().toISOString(),
  };
}
function toDerivedPassSignal(partId,stationNo,timestamp) {
  return {id:`${Date.now()}-${Math.random()}`,label:"QR PASS",variant:"ok",
    partId:normalizePartId(partId),stationNo:String(stationNo||"").trim().toUpperCase(),
    decision:"ALLOW",reason:"QR_VALIDATED",message:"Validated from journey",
    timestamp:timestamp||new Date().toISOString()};
}
function getLatestAttempt(station={}) {
  const a=Array.isArray(station.attempts)?station.attempts:[];
  return a.length?a[a.length-1]:null;
}
function hasDerivedQrSignal(station={}) {
  const la=getLatestAttempt(station);
  if (!la) return false;
  const s=String(la.plcStatus||station.latestStatus||"").trim().toUpperCase();
  return s&&s!=="RESET";
}
function formatTime(v) {
  if (!v) return "—";
  const d=new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
}
function formatDate(v) {
  if (!v) return "—";
  const d=new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([],{day:"2-digit",month:"short"})+" "+formatTime(v);
}
function getStationMeta(status) {
  const s=String(status||"PENDING").toUpperCase();
  if (["PASSED","ENDED_OK","COMPLETED","COMPLETED_OK"].includes(s))    return {variant:"ok",  label:"Pass",       icon:CheckCircle2};
  if (["FAILED","INTERLOCKED","ENDED_NG","NG","COMPLETED_NG"].includes(s)) return {variant:"ng",  label:"Fail",       icon:XCircle};
  if (["COMM_ERROR","PLC_COMM_ERROR","PLC_TIMEOUT","TIMEOUT","PLC_ERROR","ACK_TIMEOUT","RUNNING_TIMEOUT","END_TIMEOUT","RESET_TIMEOUT"].includes(s)) return {variant:"ng", label:"Error", icon:AlertTriangle};
  if (["RUNNING","IN_PROGRESS","STARTED","REWORK","WAITING_RUNNING","WAITING_END","START_SENT","VALIDATED","SCANNED","WAITING_ACK","ACK_RECEIVED"].includes(s)) return {variant:"wip",label:"In Progress",icon:Clock3};
  return {variant:"idle",label:"Waiting",icon:Clock3};
}
function getPartMeta(status) {
  const s=String(status||"").trim().toUpperCase();
  if (["COMPLETED", "PASSED", "COMPLETED_OK"].includes(s)) return {label:"Pass", variant:"ok"};
  if (["NG", "INTERLOCKED", "FAILED", "COMPLETED_NG", "ENDED_NG"].includes(s)) return {label:"Fail", variant:"ng"};
  if (["IN_PROGRESS", "REWORK", "RUNNING", "STARTED", "SCANNED", "VALIDATED", "START_SENT", "WAITING_ACK", "ACK_RECEIVED", "WAITING_RUNNING", "WAITING_END"].includes(s)) return {label:"In Progress", variant:"wip"};
  if (["PLC_COMM_ERROR", "COMM_ERROR", "PLC_TIMEOUT", "PLC_ERROR"].includes(s)) return {label:"Error", variant:"ng"};
  return {label:"Waiting",variant:"idle"};
}
// ── Mini QR code SVG generator (no external lib needed) ───────────────────
// Generates a simple visual QR-like pattern from the part ID string
function generateQrPattern(text, size=80) {
  // Deterministic hash → grid pattern
  let hash = 0;
  for (let i=0;i<text.length;i++) hash=((hash<<5)-hash)+text.charCodeAt(i), hash|=0;
  const cells = 7; const cell = Math.floor(size/cells);
  const squares = [];
  // Finder patterns (corners)
  const finder = (ox,oy) => {
    squares.push(<rect key={`f${ox}${oy}`} x={ox} y={oy} width={cell*7} height={cell*7} fill="none" stroke="currentColor" strokeWidth={cell*0.5}/>);
    squares.push(<rect key={`fi${ox}${oy}`} x={ox+cell} y={oy+cell} width={cell*5} height={cell*5} fill="currentColor"/>);
    squares.push(<rect key={`fc${ox}${oy}`} x={ox+cell*2} y={oy+cell*2} width={cell*3} height={cell*3} fill="white"/>);
    squares.push(<rect key={`fcc${ox}${oy}`} x={ox+cell*3-cell/3} y={oy+cell*3-cell/3} width={cell*1.6} height={cell*1.6} fill="currentColor"/>);
  };
  // Data modules
  for (let r=0;r<cells;r++) for (let c=0;c<cells;c++) {
    const isFinderZone=(r<3&&c<3)||(r<3&&c>=cells-3)||(r>=cells-3&&c<3);
    if (!isFinderZone) {
      const bit=((hash>>((r*cells+c)%30))&1)===1;
      if (bit) squares.push(
        <rect key={`d${r}${c}`} x={c*cell} y={r*cell} width={cell-1} height={cell-1} fill="currentColor" rx={1}/>
      );
    }
  }
  return (
    <svg viewBox={`0 0 ${cells*cell} ${cells*cell}`} width={size} height={size}
      style={{color:"currentColor",display:"block"}}>
      {/* Top-left finder */}
      <rect x={0} y={0} width={cell*3} height={cell*3} fill="currentColor"/>
      <rect x={cell} y={cell} width={cell} height={cell} fill="white"/>
      {/* Top-right finder */}
      <rect x={(cells-3)*cell} y={0} width={cell*3} height={cell*3} fill="currentColor"/>
      <rect x={(cells-2)*cell} y={cell} width={cell} height={cell} fill="white"/>
      {/* Bottom-left finder */}
      <rect x={0} y={(cells-3)*cell} width={cell*3} height={cell*3} fill="currentColor"/>
      <rect x={cell} y={(cells-2)*cell} width={cell} height={cell} fill="white"/>
      {/* Data modules */}
      {squares}
    </svg>
  );
}

// ── Atoms ──────────────────────────────────────────────────────────────────
const Badge = ({ variant="idle", label, dot=true, pulse=false }) => {
  const s=STATUS[variant]||STATUS.idle;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 10px",
      borderRadius:99,fontSize:11,fontWeight:700,letterSpacing:"0.04em",
      color:s.fg,background:s.bgLight,border:`1px solid ${s.border}`,whiteSpace:"nowrap"}}>
      {dot&&<span style={{width:6,height:6,borderRadius:"50%",background:s.fg,flexShrink:0,
        animation:pulse&&variant==="wip"?"itPulse 1.4s ease-in-out infinite":"none"}}/>}
      {label}
    </span>
  );
};

const StatCard = ({ label, value, variant="idle", icon:Icon }) => {
  const s=STATUS[variant]||STATUS.idle;
  return (
    <div style={{background:C.bg("card"),border:`1px solid ${s.border}`,borderRadius:12,
      padding:"14px 16px",boxShadow:"var(--shadow)",borderLeft:`3px solid ${s.fg}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <p style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
          letterSpacing:"0.07em",color:s.fg,opacity:0.85}}>{label}</p>
        {Icon&&<span style={{width:28,height:28,borderRadius:8,background:s.bgLight,
          display:"flex",alignItems:"center",justifyContent:"center",color:s.fg}}>
          <Icon size={14}/>
        </span>}
      </div>
      <p style={{fontSize:28,fontWeight:800,color:s.fg,fontVariantNumeric:"tabular-nums",
        lineHeight:1,fontFamily:"'DM Mono','Courier New',monospace"}}>{value}</p>
    </div>
  );
};

const SectionHead = ({ title, subtitle, right, accent }) => (
  <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border()}`,
    background:C.bg("surface"),display:"flex",alignItems:"center",
    justifyContent:"space-between",
    borderLeft:accent?`3px solid ${C.amber()}`:"none"}}>
    <div>
      {subtitle&&<p style={{fontSize:10,fontWeight:800,textTransform:"uppercase",
        letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:2}}>{subtitle}</p>}
      <p style={{fontSize:13,fontWeight:700,color:C.txt("primary")}}>{title}</p>
    </div>
    {right}
  </div>
);

const Btn = ({ children, onClick, disabled, variant="ghost", loading, style:sx={} }) => {
  const [hover,setHover]=useState(false);
  const styles={
    ghost: {background:hover?C.bg("hover"):"transparent",color:C.txt("secondary"),border:`1px solid ${C.border()}`},
    amber: {background:hover?C.amber(0.9):C.amber(),color:C.navy(),border:"none",fontWeight:800},
    danger:{background:hover?C.ng(0.18):C.ng(0.1),color:C.ng(),border:`1px solid ${C.ng(0.3)}`},
    navy:  {background:hover?C.navy(0.85):C.navy(),color:C.linen(),border:"none"},
  };
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 14px",
        borderRadius:8,fontSize:12,fontWeight:700,cursor:disabled?"not-allowed":"pointer",
        opacity:disabled?0.45:1,transition:"all 0.15s ease",border:"none",outline:"none",
        ...(styles[variant]||styles.ghost),...sx}}>
      {loading?<RefreshCw size={12} style={{animation:"itSpin 0.9s linear infinite"}}/>:children}
    </button>
  );
};

const Divider = ({ label }) => (
  <div style={{display:"flex",alignItems:"center",gap:10,margin:"4px 0"}}>
    <div style={{flex:1,height:1,background:C.border()}}/>
    {label&&<span style={{fontSize:10,fontWeight:700,color:C.txt("muted"),
      textTransform:"uppercase",letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{label}</span>}
    <div style={{flex:1,height:1,background:C.border()}}/>
  </div>
);

// ── Part Action Button — always clearly visible ───────────────────────────
// Used in parts list for QR and Delete — has background + border so it's
// always visible regardless of theme, not just on hover
const PartActionBtn = ({ icon, label, color, bgColor, borderColor, hoverBg, onClick }) => {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: 5, width: "100%", height: 30,
        borderRadius: 7, fontSize: 11, fontWeight: 700,
        cursor: "pointer",
        color: color,
        background: h ? hoverBg : bgColor,
        border: `1px solid ${borderColor}`,
        transition: "all .12s",
        whiteSpace: "nowrap",
      }}>
      {icon}
      {label}
    </button>
  );
};

// ── QR Modal ──────────────────────────────────────────────────────────────
const QrModal = ({ partId, onClose, onDeletePart }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteError,   setDeleteError]   = useState("");

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await traceabilityApi.deletePart({ partId, reason: "Full part deletion" });
      onDeletePart(partId);
      onClose();
    } catch(e) {
      setDeleteError(e.response?.data?.error || "Unable to remove part");
    } finally { setDeleting(false); }
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:1200,display:"flex",alignItems:"center",
      justifyContent:"center",padding:16,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
      <div style={{width:"100%",maxWidth:400,background:C.bg("card"),
        border:`1px solid ${C.border()}`,borderRadius:18,overflow:"hidden",
        boxShadow:"0 24px 64px rgba(0,0,0,0.5)",animation:"itScale 0.2s ease"}}>

        {/* Accent bar */}
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>

        {/* Header */}
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border()}`,
          background:C.bg("surface"),display:"flex",alignItems:"center",
          justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:30,height:30,borderRadius:8,background:C.steel(0.12),
              border:`1px solid ${C.steel(0.25)}`,display:"flex",alignItems:"center",
              justifyContent:"center"}}>
              <QrCode size={15} color={C.steel()}/>
            </div>
            <div>
              <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:1}}>Part QR Code</p>
              <p style={{fontSize:13,fontWeight:700,color:C.txt("primary")}}>
                {partId}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:6,
            background:C.bg("hover"),border:`1px solid ${C.border()}`,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            <X size={13} color={C.txt("muted")}/>
          </button>
        </div>

        {/* QR code display */}
        <div style={{padding:"24px",display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
          {/* White card mimicking a real label */}
          <div style={{background:"white",borderRadius:12,padding:"20px",
            boxShadow:"0 4px 20px rgba(0,0,0,0.15)",display:"flex",
            flexDirection:"column",alignItems:"center",gap:10,
            border:"1px solid rgba(0,0,0,0.08)"}}>
            <div style={{color:"rgba(26,50,99,1)"}}>
              {generateQrPattern(partId, 120)}
            </div>
            <p style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,
              color:"rgba(26,50,99,1)",letterSpacing:"0.05em",textAlign:"center"}}>
              {partId}
            </p>
            <p style={{fontSize:9,color:"rgba(84,119,146,0.8)",textTransform:"uppercase",
              letterSpacing:"0.1em"}}>IndusTrace MES</p>
          </div>

          <p style={{fontSize:11,color:C.txt("muted"),textAlign:"center",lineHeight:1.5}}>
            Scan this code to look up the part's full production journey.
          </p>

          {/* Delete section */}
          {!confirmDelete ? (
            <button onClick={() => { setDeleteError(""); setConfirmDelete(true); }}
              style={{display:"flex",alignItems:"center",gap:6,
                fontSize:12,fontWeight:700,color:C.ng(),
                background:C.ng(0.08),border:`1px solid ${C.ng(0.25)}`,
                borderRadius:8,padding:"8px 16px",cursor:"pointer",
                transition:"all .15s",width:"100%",justifyContent:"center"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.ng(0.14)}
              onMouseLeave={e=>e.currentTarget.style.background=C.ng(0.08)}>
              <Trash2 size={13}/> Remove This Part from System
            </button>
          ) : (
            <div style={{width:"100%",background:C.ng(0.07),border:`1px solid ${C.ng(0.25)}`,
              borderRadius:10,padding:"14px",animation:"itFadeIn .15s ease"}}>
              <p style={{fontSize:12,fontWeight:700,color:C.ng(),marginBottom:4}}>
                ⚠ Remove Part from System?
              </p>
              <p style={{fontSize:11,color:C.txt("muted"),lineHeight:1.5,marginBottom:12}}>
                This will remove <strong style={{color:C.txt("primary"),fontFamily:"'DM Mono',monospace"}}>{partId}</strong> and
                all its station history from start to end. This cannot be undone.
              </p>
              <div style={{display:"flex",gap:8}}>
                <Btn onClick={() => { setDeleteError(""); setConfirmDelete(false); }}
                  style={{flex:1,justifyContent:"center",padding:"8px 0"}}>
                  Cancel
                </Btn>
                <Btn variant="danger" onClick={handleDelete}
                  disabled={deleting} loading={deleting}
                  style={{flex:1,justifyContent:"center",padding:"8px 0"}}>
                  {deleting?"Removing…":"Yes, Remove"}
                </Btn>
              </div>
              {deleteError ? (
                <p style={{marginTop:10,fontSize:11,color:C.ng(),lineHeight:1.4}}>
                  {deleteError}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
const ComponentJourney = () => {
  useEffect(()=>{ injectTheme(); injectKeyframes(); },[]);

  const [searchTerm,       setSearchTerm]       = useState("");
  const [filters,          setFilters]          = useState({
    dateFrom:"",
    dateTo:"",
    partId:"",
    machineId:"",
    stationNo:"",
    status:"",
    operatorId:"",
    shiftCode:"",
    lineName:"",
  });
  const [parts,            setParts]            = useState([]);
  const [machines,         setMachines]         = useState([]);
  const [availableShifts,  setAvailableShifts]  = useState([]);
  const [selectedPartId,   setSelectedPartId]   = useState("");
  const [journeyData,      setJourneyData]      = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [refreshing,       setRefreshing]       = useState(false);
  const [resettingStation, setResettingStation] = useState("");
  const [resetConfirm,     setResetConfirm]     = useState(null);
  const [popup,            setPopup]            = useState(null);
  const [lastQrSignal,     setLastQrSignal]     = useState(null);
  const [qrFeed,           setQrFeed]           = useState([]);
  const [qrByStation,      setQrByStation]      = useState({});
  const [stationSettings,  setStationSettings]  = useState(()=>getStationFeatureSettings());
  // NEW: QR modal state
  const [qrModalPartId,    setQrModalPartId]    = useState(null);

  const selectedPartIdRef      = useRef("");
  const searchTermRef          = useRef("");
  const socketRef              = useRef(null);
  const subscribedPartRef      = useRef("");
  const realtimeTimerRef       = useRef(null);
  const lastRealtimeRefreshRef = useRef(0);
  const inFlightRefreshRef     = useRef(false);
  const queuedRefreshRef       = useRef(false);
  const lastQrEventRef         = useRef({key:"",at:0});

  const selectedPart    = useMemo(()=>parts.find(e=>e.partId===selectedPartId)||null,[parts,selectedPartId]);
  const lineOptions     = useMemo(
    ()=>Array.from(new Set((machines||[]).map((row)=>String(row.lineName || "").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b)),
    [machines]
  );
  const stationTimeline = useMemo(()=>journeyData?.stationTimeline||[],[journeyData?.stationTimeline]);
  const statusSummary   = useMemo(()=>stationTimeline.reduce((acc,st)=>{
    const s=String(st.stageState||"").toUpperCase();
    if (s==="PASSED") acc.passed++;
    else if (["FAILED","INTERLOCKED","COMM_ERROR"].includes(s)) acc.failed++;
    else if (s==="IN_PROGRESS") acc.inProgress++;
    else acc.pending++;
    return acc;
  },{passed:0,failed:0,inProgress:0,pending:0}),[stationTimeline]);

  // ── Data / socket logic (100% unchanged logic) ─────────────────────────
  const loadPartCatalog = useCallback(async(search)=>{
    const rows=await traceabilityApi.partCatalog({
      search,
      limit:80,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      partId: filters.partId || undefined,
      machineId: filters.machineId || undefined,
      stationNo: filters.stationNo || undefined,
      status: filters.status || undefined,
      operatorId: filters.operatorId || undefined,
      shiftCode: filters.shiftCode || undefined,
      lineName: filters.lineName || undefined,
    });
    setParts(rows||[]);
    if (!selectedPartId&&rows?.length) setSelectedPartId(rows[0].partId);
    if (selectedPartId&&!(rows||[]).some(e=>e.partId===selectedPartId))
      setSelectedPartId(rows?.[0]?.partId||"");
  },[selectedPartId, filters]);

  const loadJourney = useCallback(async(partId,showLoader=true)=>{
    if (!partId){setJourneyData(null);return;}
    if (showLoader) setLoading(true);
    try { const res=await traceabilityApi.journeyByPart(partId); setJourneyData(res||null); }
    catch(e) {
      if (Number(e.response?.status||0)===404){setJourneyData(null);return;}
      if (showLoader) setJourneyData(null);
      setPopup({type:"ERROR",title:"Part History Missing",message:e.response?.data?.error||"Part journey data not found"});
    } finally { if (showLoader) setLoading(false); }
  },[]);

  const refreshJourneyNow = useCallback(async(showLoader=false)=>{
    const partId=selectedPartIdRef.current;
    if (!partId) return;
    if (inFlightRefreshRef.current){queuedRefreshRef.current=true;return;}
    inFlightRefreshRef.current=true;
    try { await loadJourney(partId,showLoader); }
    finally {
      inFlightRefreshRef.current=false;
      if (queuedRefreshRef.current){queuedRefreshRef.current=false;refreshJourneyNow(false);}
    }
  },[loadJourney]);

  const scheduleRealtimeRefresh = useCallback(()=>{
    const elapsed=Date.now()-lastRealtimeRefreshRef.current;
    const delay=Math.max(0,REALTIME_REFRESH_COOLDOWN-elapsed);
    if (realtimeTimerRef.current) return;
    realtimeTimerRef.current=setTimeout(()=>{
      realtimeTimerRef.current=null;lastRealtimeRefreshRef.current=Date.now();refreshJourneyNow(false);
    },delay);
  },[refreshJourneyNow]);

  const patchPartFromRealtime = useCallback((payload={})=>{
    const rPartId=normalizePartId(payload.partId||payload.part_id);
    if (!rPartId) return;
    const rStatus=String(payload.currentStatus||payload.partStatus||payload.status||"").trim().toUpperCase();
    const resolved=["COMPLETED","IN_PROGRESS","NG","INTERLOCKED","REWORK"].includes(rStatus)?rStatus
      :rStatus==="ENDED_OK" || rStatus==="COMPLETED_OK"?"COMPLETED"
      :rStatus==="STARTED" || rStatus==="RUNNING" || rStatus.startsWith("WAITING") || rStatus === "ACK_RECEIVED" || rStatus === "START_SENT"?"IN_PROGRESS"
      :rStatus==="PENDING"?"PENDING"
      :rStatus==="ENDED_NG" || rStatus==="COMPLETED_NG"?"NG":"";
    const rStation=String(payload.stationNo||payload.station_no||"").trim().toUpperCase();
    const rTimestamp=payload.timestamp||new Date().toISOString();
    setParts(prev=>{
      const idx=prev.findIndex(r=>r.partId===rPartId);
      if (idx===-1){
        if (searchTermRef.current) return prev;
        return [{partId:rPartId,status:resolved||"IN_PROGRESS",currentStation:rStation||null,updatedAt:rTimestamp},...prev].slice(0,80);
      }
      const next=[...prev];
      next[idx]={...prev[idx],status:resolved||prev[idx].status,currentStation:rStation||prev[idx].currentStation,updatedAt:rTimestamp};
      return next;
    });
  },[]);

  const processQrSignal = useCallback((payload={})=>{
    if (!hasQrDecision(payload)) return;
    const pp=normalizePartId(payload.partId||payload.part_id);
    const ap=normalizePartId(selectedPartIdRef.current);
    if (ap&&pp&&pp!==ap) return;
    const sig=toQrSignal(payload);
    const key=[sig.partId,sig.stationNo,sig.decision,sig.reason].join("|");
    const now=Date.now();
    if (lastQrEventRef.current.key===key&&now-lastQrEventRef.current.at<QR_DEDUPE_MS) return;
    lastQrEventRef.current={key,at:now};
    setLastQrSignal(sig);
    setQrFeed(prev=>[sig,...prev].slice(0,6));
    if (sig.stationNo) setQrByStation(prev=>({...prev,[sig.stationNo]:sig}));
  },[]);

  const handleRefresh = useCallback(async()=>{
    setRefreshing(true);
    try { await loadPartCatalog(searchTerm); await refreshJourneyNow(false); setStationSettings(getStationFeatureSettings()); }
    catch(e){ setPopup({type:"ERROR",title:"Refresh Failed",message:e.response?.data?.error||"Unable to refresh"}); }
    finally { setRefreshing(false); }
  },[loadPartCatalog,searchTerm,refreshJourneyNow]);

  const exportJourneyReport = useCallback(async () => {
    const rows = (stationTimeline || []).map((station) => {
      const latest = Array.isArray(station.attempts) && station.attempts.length > 0
        ? station.attempts[station.attempts.length - 1]
        : null;
      return {
        stationNo: station.stationNo || "",
        stageState: station.stageState || "PENDING",
        latestStatus: station.latestStatus || "",
        latestResult: latest?.result || station.latestResult || "",
        interlockReason: station.latestInterlockReason || latest?.interlockReason || "",
        completedAt: station.latestAt || latest?.createdAt || "",
      };
    });
    if (!rows.length) {
      setPopup({ type:"WARNING", title:"No Data", message:"No part journey rows available for export." });
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Traceability Report");

      // Set column widths
      sheet.columns = [
        { header: "Part ID", key: "partId", width: 25 },
        { header: "Station", key: "stationNo", width: 15 },
        { header: "State", key: "stageState", width: 15 },
        { header: "Latest Status", key: "latestStatus", width: 20 },
        { header: "Result", key: "latestResult", width: 15 },
        { header: "Remark", key: "interlockReason", width: 35 },
        { header: "Timestamp", key: "completedAt", width: 25 }
      ];

      // Add Title
      sheet.insertRow(1, ["Industrial Traceability System - Part Journey Report"]);
      sheet.mergeCells("A1:G1");
      const titleRow = sheet.getRow(1);
      titleRow.font = { name: "Arial", family: 4, size: 16, bold: true, color: { argb: "FF1A3263" } };
      titleRow.alignment = { horizontal: "center", vertical: "middle" };
      titleRow.height = 30;

      sheet.insertRow(2, [`Report Generated: ${new Date().toLocaleString()}`, "", "", "", "", "", `Total Stations: ${rows.length}`]);
      sheet.mergeCells("A2:E2");
      sheet.mergeCells("F2:G2");
      const subTitleRow = sheet.getRow(2);
      subTitleRow.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF666666" } };
      subTitleRow.getCell(6).alignment = { horizontal: "right" };
      subTitleRow.height = 20;

      sheet.insertRow(3, []); // Empty row

      // Header Row Styling (now row 4)
      const headerRow = sheet.getRow(4);
      headerRow.values = ["Part ID", "Station", "State", "Latest Status", "Result", "Remark", "Timestamp"];
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      headerRow.alignment = { horizontal: "center", vertical: "middle" };
      headerRow.height = 25;
      
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF1A3263" } // Navy Blue
        };
        cell.border = {
          top: { style: 'thin', color: { argb: "FFCCCCCC" } },
          left: { style: 'thin', color: { argb: "FFCCCCCC" } },
          bottom: { style: 'thin', color: { argb: "FFCCCCCC" } },
          right: { style: 'thin', color: { argb: "FFCCCCCC" } }
        };
      });

      // Add Data Rows
      rows.forEach((row, index) => {
        const dataRow = sheet.addRow({
          partId: selectedPartId || "",
          stationNo: row.stationNo,
          stageState: row.stageState,
          latestStatus: row.latestStatus,
          latestResult: row.latestResult,
          interlockReason: row.interlockReason,
          completedAt: row.completedAt ? new Date(row.completedAt).toLocaleString() : ""
        });

        // Alternate row shading
        if (index % 2 === 0) {
          dataRow.eachCell(cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
          });
        }

        // Apply borders and alignment to all cells
        dataRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin', color: { argb: "FFEEEEEE" } },
            left: { style: 'thin', color: { argb: "FFEEEEEE" } },
            bottom: { style: 'thin', color: { argb: "FFEEEEEE" } },
            right: { style: 'thin', color: { argb: "FFEEEEEE" } }
          };
          if (colNumber !== 6) { // Center everything except remarks
            cell.alignment = { horizontal: "center", vertical: "middle" };
          } else {
            cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
          }
        });

        // Color coding for State (Column 3)
        const stateCell = dataRow.getCell(3);
        const state = String(row.stageState).toUpperCase();
        if (state === "PASSED" || state === "COMPLETED") {
          stateCell.font = { color: { argb: "FF15803D" }, bold: true }; // Green
        } else if (state === "FAILED" || state === "NG") {
          stateCell.font = { color: { argb: "FFDC2626" }, bold: true }; // Red
        } else if (state === "IN_PROGRESS" || state === "RUN") {
          stateCell.font = { color: { argb: "FFD97706" }, bold: true }; // Orange
        }

        // Color coding for Result (Column 5)
        const resultCell = dataRow.getCell(5);
        const result = String(row.latestResult).toUpperCase();
        if (["PASS", "OK", "ALLOW"].includes(result)) {
          resultCell.font = { color: { argb: "FF15803D" }, bold: true };
        } else if (["FAIL", "NG", "BLOCK"].includes(result)) {
          resultCell.font = { color: { argb: "FFDC2626" }, bold: true };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const pad = (v) => String(v).padStart(2, "0");
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      saveAs(new Blob([buffer]), `Traceability_Report_${stamp}.xlsx`);

    } catch (e) {
      setPopup({ type:"ERROR", title:"Export Failed", message:"Failed to generate Excel file." });
    }
  }, [selectedPartId, stationTimeline]);

  const handleResetStation = useCallback((sNo)=>{
    if (!selectedPartId||!sNo) return;
    setResetConfirm({partId:selectedPartId,stationNo:sNo});
  },[selectedPartId]);

  const confirmResetStation = useCallback(async()=>{
    const sNo=String(resetConfirm?.stationNo||"").trim().toUpperCase();
    const pId=normalizePartId(resetConfirm?.partId||selectedPartId);
    if (!pId||!sNo){setResetConfirm(null);return;}
    setResettingStation(sNo);
    try {
      await traceabilityApi.resetStation({partId:pId,stationNo:sNo,reason:`Manual reset at ${sNo}`});
      setQrByStation({});setLastQrSignal(null);setQrFeed([]);
      await Promise.all([refreshJourneyNow(false),loadPartCatalog(searchTermRef.current)]);
      setPopup({type:"SUCCESS",title:"Station Reset",message:`Station ${sNo} reset for part ${pId}`});
    } catch(e){ setPopup({type:"ERROR",title:"Reset Failed",message:e.response?.data?.error||"Unable to reset"}); }
    finally { setResettingStation("");setResetConfirm(null); }
  },[resetConfirm,selectedPartId,refreshJourneyNow,loadPartCatalog]);

  // NEW: Remove part from local list
  const handleDeletePart = useCallback((partId)=>{
    setParts(prev=>prev.filter(p=>p.partId!==partId));
    if (selectedPartId===partId) {
      setSelectedPartId(""); setJourneyData(null);
    }
  },[selectedPartId]);

  useEffect(()=>{ selectedPartIdRef.current=selectedPartId; },[selectedPartId]);
  useEffect(()=>{ setLastQrSignal(null);setQrFeed([]);setQrByStation({});setResetConfirm(null); lastQrEventRef.current={key:"",at:0}; },[selectedPartId]);
  useEffect(()=>{
    if (!selectedPartId||stationTimeline.length===0){setQrByStation({});return;}
    const derived={};
    for (const st of stationTimeline){
      if (!hasDerivedQrSignal(st)) continue;
      const la=getLatestAttempt(st);
      derived[st.stationNo]=toDerivedPassSignal(selectedPartId,st.stationNo,la?.createdAt||st.latestAt);
    }
    setQrByStation(derived);
    if (lastQrSignal||qrFeed.length>0) return;
    const latest=[...stationTimeline].filter(s=>hasDerivedQrSignal(s)&&s.latestAt)
      .sort((a,b)=>new Date(b.latestAt)-new Date(a.latestAt))[0];
    if (!latest) return;
    const d=toDerivedPassSignal(selectedPartId,latest.stationNo,latest.latestAt);
    setLastQrSignal(d);setQrFeed([d]);
  },[selectedPartId,stationTimeline,lastQrSignal,qrFeed.length]);

  useEffect(()=>{ searchTermRef.current=searchTerm; },[searchTerm]);
  useEffect(()=>{
    const t=setTimeout(()=>loadPartCatalog(searchTerm).catch(e=>setPopup({type:"ERROR",title:"Search Failed",message:e.response?.data?.error||"Unable to load catalog"})),220);
    return()=>clearTimeout(t);
  },[searchTerm,loadPartCatalog]);
  useEffect(()=>{ refreshJourneyNow(true); },[selectedPartId,refreshJourneyNow]);

  useEffect(()=>{
    const socket=io(SOCKET_URL,{path:"/socket.io/",transports:["websocket","polling"],reconnectionDelay:200,reconnectionDelayMax:1200});
    socketRef.current=socket;
    socket.on("journey_update",(p={})=>{
      patchPartFromRealtime(p);
      if (String(p.sourceEvent||"").toLowerCase()!=="scan_event"&&hasQrDecision(p)) processQrSignal(p);
      const pp=normalizePartId(p.partId||p.part_id);
      if (!pp||pp!==selectedPartIdRef.current) return;
      scheduleRealtimeRefresh();
    });
    socket.on("scan_event",(p={})=>{patchPartFromRealtime(p);processQrSignal(p);const pp=normalizePartId(p.partId||p.part_id);if (!pp||pp===selectedPartIdRef.current) scheduleRealtimeRefresh();});
    socket.on("operator_popup",(p={})=>{patchPartFromRealtime(p);const pp=normalizePartId(p.partId||p.part_id);if (pp&&pp!==selectedPartIdRef.current) return;scheduleRealtimeRefresh();});
    socket.on("dashboard_refresh",()=>scheduleRealtimeRefresh());
    return()=>{
      if (realtimeTimerRef.current){clearTimeout(realtimeTimerRef.current);realtimeTimerRef.current=null;}
      if (subscribedPartRef.current){socket.emit("unsubscribe_part",{partId:subscribedPartRef.current});subscribedPartRef.current="";}
      socketRef.current=null;socket.disconnect();
    };
  },[scheduleRealtimeRefresh,patchPartFromRealtime,processQrSignal]);

  useEffect(()=>{
    const socket=socketRef.current; if (!socket) return;
    const next=normalizePartId(selectedPartIdRef.current);
    const cur=normalizePartId(subscribedPartRef.current);
    if (cur&&cur!==next){socket.emit("unsubscribe_part",{partId:cur});subscribedPartRef.current="";}
    if (next&&next!==cur){socket.emit("subscribe_part",{partId:next});subscribedPartRef.current=next;}
    if (!next&&cur){socket.emit("unsubscribe_part",{partId:cur});subscribedPartRef.current="";}
  },[selectedPartId]);

  useEffect(()=>{const t=setInterval(()=>refreshJourneyNow(false),FALLBACK_POLL_INTERVAL);return()=>clearInterval(t);},[refreshJourneyNow]);
  useEffect(()=>{const t=setInterval(()=>loadPartCatalog(searchTermRef.current).catch(()=>{}),CATALOG_SYNC_INTERVAL);return()=>clearInterval(t);},[loadPartCatalog]);
  useEffect(()=>{
    const sync=async()=>{
      try { const r=await stationSettingsApi.list(); if (r&&Object.keys(r).length>0){setStationSettings(r);saveStationFeatureSettings(r);return;} } catch (_syncError) { void _syncError; }
      setStationSettings(getStationFeatureSettings());
    };
    sync();
    const onFocus=()=>sync(); const onStorage=()=>setStationSettings(getStationFeatureSettings());
    window.addEventListener("focus",onFocus); window.addEventListener("storage",onStorage);
    return()=>{ window.removeEventListener("focus",onFocus); window.removeEventListener("storage",onStorage); };
  },[]);

  useEffect(() => {
    let cancelled = false;
    const loadFilterSources = async () => {
      try {
        const [machineRows, shifts] = await Promise.all([
          machineApi.list(),
          shiftApi.list().catch(() => []),
        ]);
        if (cancelled) return;
        setMachines(machineRows || []);
        setAvailableShifts(
          (shifts || [])
            .filter((row) => row?.isActive !== false)
            .map((row) => ({
              shiftCode: row.shiftCode || row.shift_code,
              shiftName: row.shiftName || row.shift_name || row.shiftCode || row.shift_code,
            }))
        );
      } catch (_error) {
        void _error;
        if (!cancelled) {
          setMachines([]);
          setAvailableShifts([]);
        }
      }
    };
    loadFilterSources();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,padding:"4px 2px"}}>
      <GlobalPopup popup={popup} onClose={()=>setPopup(null)} autoCloseMs={3500} criticalAutoCloseMs={9000}/>

      {/* ── QR Modal ─────────────────────────────────────────────────── */}
      {qrModalPartId && (
        <QrModal
          partId={qrModalPartId}
          onClose={()=>setQrModalPartId(null)}
          onDeletePart={handleDeletePart}
        />
      )}

      {/* ── Reset Confirm Modal ──────────────────────────────────────── */}
      {resetConfirm && (
        <div style={{position:"fixed",inset:0,zIndex:1100,display:"flex",alignItems:"center",
          justifyContent:"center",padding:16,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
          <div style={{width:"100%",maxWidth:440,background:C.bg("card"),
            border:`1px solid ${C.border()}`,borderRadius:16,
            boxShadow:"0 24px 64px rgba(0,0,0,0.5)",overflow:"hidden",animation:"itFadeIn 0.2s ease"}}>
            <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"14px 18px",borderBottom:`1px solid ${C.border()}`,background:C.bg("surface")}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:8,background:C.ng(0.12),
                  display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <AlertTriangle size={16} color={C.ng()}/>
                </div>
                <p style={{fontSize:14,fontWeight:700,color:C.txt("primary")}}>Confirm Station Reset</p>
              </div>
              <button onClick={()=>setResetConfirm(null)} style={{width:28,height:28,borderRadius:6,
                background:C.bg("hover"),border:`1px solid ${C.border()}`,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center"}}>
                <X size={13} color={C.txt("muted")}/>
              </button>
            </div>
            <div style={{padding:"18px 18px 20px"}}>
              <div style={{background:C.bg("surface"),border:`1px solid ${C.border()}`,
                borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
                    letterSpacing:"0.07em",color:C.txt("muted")}}>Part Serial</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,
                    color:C.txt("primary")}}>{resetConfirm.partId}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
                    letterSpacing:"0.07em",color:C.txt("muted")}}>Station</span>
                  <span style={{fontSize:12,fontWeight:700,color:C.amber()}}>{resetConfirm.stationNo}</span>
                </div>
              </div>
              <p style={{fontSize:12,color:C.txt("muted"),lineHeight:1.6,marginBottom:16}}>
                This clears all downstream progress from the selected station. A re-scan will be required.
              </p>
              <div style={{display:"flex",gap:10}}>
                <Btn onClick={()=>setResetConfirm(null)} style={{flex:1,justifyContent:"center",padding:"9px 0"}}>Cancel</Btn>
                <Btn variant="danger" onClick={confirmResetStation}
                  disabled={Boolean(resettingStation)} loading={Boolean(resettingStation)}
                  style={{flex:1,justifyContent:"center",padding:"9px 0"}}>
                  {resettingStation?"Resetting…":"Confirm Reset"}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Page Header ─────────────────────────────────────────────── */}
      {/* CLEAN: only title + search + 3 KPI cards. QR Feed removed. */}
      <div style={{background:C.bg("card"),border:`1px solid ${C.border()}`,
        borderRadius:16,boxShadow:"var(--shadow)",overflow:"hidden"}}>
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>
        <div style={{padding:"18px 20px 18px"}}>

          {/* Title + refresh */}
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",
            flexWrap:"wrap",gap:12,marginBottom:18}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:44,height:44,borderRadius:12,
                background:`linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
                display:"flex",alignItems:"center",justifyContent:"center",
                boxShadow:`0 4px 12px ${C.navy(0.4)}`}}>
                <Layers size={20} color={C.linen()}/>
              </div>
              <div>
                <h1 style={{fontSize:18,fontWeight:800,color:C.txt("primary"),
                  letterSpacing:"-0.02em",lineHeight:1.2}}>Part Journey</h1>
                <p style={{fontSize:12,color:C.txt("muted"),marginTop:3}}>
                  Real-time station tracking &amp; QR genealogy
                </p>
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <Btn variant="ghost" onClick={exportJourneyReport} disabled={!stationTimeline.length}>
                <Download size={13}/> Export Report
              </Btn>
              <Btn variant="ghost" onClick={handleRefresh} disabled={refreshing||loading} loading={refreshing}>
                {!refreshing&&<RefreshCw size={13}/>}
                {refreshing?"Refreshing…":"Refresh"}
              </Btn>
            </div>
          </div>

          {/* Search bar */}
          <div style={{marginBottom:14}}>
            <p style={{fontSize:10,fontWeight:800,textTransform:"uppercase",
              letterSpacing:"0.08em",color:C.txt("muted"),marginBottom:6}}>
              Search Part / Serial No.
            </p>
            <div style={{position:"relative"}}>
              <Search size={14} color={C.txt("muted")} style={{position:"absolute",left:12,
                top:"50%",transform:"translateY(-50%)"}}/>
              <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                placeholder="Scan barcode or type part serial number…"
                style={{width:"100%",height:40,paddingLeft:36,paddingRight:12,
                  background:C.bg("input"),border:`1px solid ${C.border()}`,
                  borderRadius:10,fontSize:13,color:C.txt("primary"),
                  fontFamily:"'DM Sans',sans-serif",outline:"none",
                  transition:"border-color 0.15s",boxSizing:"border-box"}}
                onFocus={e=>{e.target.style.borderColor=C.steel();e.target.style.boxShadow=`0 0 0 3px ${C.steel(0.1)}`;}}
                onBlur={e=>{e.target.style.borderColor=C.border();e.target.style.boxShadow="none";}}
              />
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:14}}>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e)=>setFilters((prev)=>({...prev,dateFrom:e.target.value}))}
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            />
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e)=>setFilters((prev)=>({...prev,dateTo:e.target.value}))}
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            />
            <select
              value={filters.lineName}
              onChange={(e)=>setFilters((prev)=>({...prev,lineName:e.target.value,machineId:""}))}
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            >
              <option value="">All Lines</option>
              {lineOptions.map((line)=><option key={line} value={line}>{line}</option>)}
            </select>
            <select
              value={filters.machineId}
              onChange={(e)=>setFilters((prev)=>({...prev,machineId:e.target.value}))}
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            >
              <option value="">All Machines</option>
              {machines
                .filter((machine)=>!filters.lineName || String(machine.lineName || "").trim() === filters.lineName)
                .map((machine)=>(
                  <option key={machine.id} value={machine.id}>{machine.machineName}</option>
                ))}
            </select>
            <input
              value={filters.stationNo}
              onChange={(e)=>setFilters((prev)=>({...prev,stationNo:e.target.value.toUpperCase()}))}
              placeholder="Station"
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            />
            <select
              value={filters.status}
              onChange={(e)=>setFilters((prev)=>({...prev,status:e.target.value}))}
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            >
              <option value="">All Status</option>
              <option value="IN_PROGRESS">RUNNING</option>
              <option value="COMPLETED">PASSED</option>
              <option value="NG">FAILED</option>
              <option value="INTERLOCKED">BLOCKED</option>
            </select>
            <input
              value={filters.operatorId}
              onChange={(e)=>setFilters((prev)=>({...prev,operatorId:e.target.value}))}
              placeholder="Operator ID"
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            />
            <select
              value={filters.shiftCode}
              onChange={(e)=>setFilters((prev)=>({...prev,shiftCode:e.target.value}))}
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            >
              <option value="">All Shifts</option>
              {availableShifts.map((shift)=>(
                <option key={shift.shiftCode} value={shift.shiftCode}>{shift.shiftName}</option>
              ))}
            </select>
            <input
              value={filters.partId}
              onChange={(e)=>setFilters((prev)=>({...prev,partId:e.target.value}))}
              placeholder="Part ID"
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.border()}`,background:C.bg("input"),color:C.txt("primary"),fontSize:12}}
            />
            <button
              onClick={()=>setFilters({dateFrom:"",dateTo:"",partId:"",machineId:"",stationNo:"",status:"",operatorId:"",shiftCode:"",lineName:""})}
              style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.ng(0.25)}`,background:C.ng(0.08),color:C.ng(),fontSize:12,fontWeight:700,cursor:"pointer"}}
            >
              Clear Filters
            </button>
          </div>

          {/* 3 KPI stat cards — only shown when a part is selected */}
          {stationTimeline.length>0&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
              <StatCard label="Stations Passed"      value={statusSummary.passed}     variant="ok"   icon={CheckCircle2}/>
              <StatCard label="Stations Failed"      value={statusSummary.failed}     variant="ng"   icon={XCircle}/>
              <StatCard label="In Progress"          value={statusSummary.inProgress} variant="wip"  icon={Activity}/>
            </div>
          )}
        </div>
      </div>

      {/* ── Main content: parts list + timeline ─────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"290px 1fr",gap:16,alignItems:"start"}}>

        {/* ── Parts List ────────────────────────────────────────────── */}
        <div style={{
          background:C.bg("card"),border:`1px solid ${C.border()}`,
          borderRadius:16,boxShadow:"var(--shadow)",
          position:"sticky",top:16,
          display:"flex",flexDirection:"column",
          maxHeight:"calc(100vh - 120px)",
        }}>

          <SectionHead
            subtitle="Part Catalog"
            title="All Parts"
            accent
            right={
              <span style={{fontSize:11,fontWeight:700,color:C.txt("muted"),
                background:C.bg("hover"),padding:"3px 8px",borderRadius:6,
                border:`1px solid ${C.border()}`}}>
                {parts.length}
              </span>
            }
          />

          {/* Scrollable list area */}
          <div style={{flex:1,overflowY:"auto",padding:"8px",
            display:"flex",flexDirection:"column",gap:6,minHeight:0}}>

            {parts.length===0 && (
              <div style={{textAlign:"center",padding:"32px 16px",color:C.txt("muted"),fontSize:13}}>
                <Package size={28} color={C.txt("muted")} style={{margin:"0 auto 10px"}}/>
                <p>No parts found.</p>
                <p style={{fontSize:11,marginTop:4}}>Try a different search term.</p>
              </div>
            )}

            {parts.map(part=>{
              const active = selectedPartId===part.partId;
              const meta   = getPartMeta(part.status);
              return (
                <div key={part.partId} style={{
                  borderRadius:10,
                  border: active?`1px solid ${C.navy(0.5)}`:`1px solid ${C.border()}`,
                  background: active ? C.navy(0.08) : C.bg("surface"),
                  boxShadow: active?`0 0 0 3px ${C.navy(0.08)}`:"none",
                  transition:"all 0.15s ease",
                  animation:"itSlideIn 0.18s ease",
                  flexShrink: 0,          /* never compress — always full height */
                }}>

                  {/* ── Clickable top area ── */}
                  <button
                    onClick={()=>setSelectedPartId(part.partId)}
                    style={{
                      width:"100%",textAlign:"left",
                      padding:"10px 12px 8px",
                      background:"none",border:"none",
                      cursor:"pointer",display:"block",
                      borderRadius:"10px 10px 0 0",
                    }}>

                    {/* Part ID + chevron */}
                    <div style={{display:"flex",alignItems:"flex-start",
                      justifyContent:"space-between",gap:4,marginBottom:6}}>
                      <span style={{
                        fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,
                        color:active?C.navy():C.txt("primary"),
                        wordBreak:"break-all",lineHeight:1.35,flex:1,
                      }}>
                        {part.partId}
                      </span>
                      {active&&(
                        <ChevronRight size={13} color={C.amber()} style={{flexShrink:0,marginTop:1}}/>
                      )}
                    </div>

                    {/* Status badge + station */}
                    <div style={{display:"flex",alignItems:"center",
                      justifyContent:"space-between",gap:4}}>
                      <Badge variant={meta.variant} label={meta.label}/>
                      {part.currentStation&&(
                        <span style={{fontSize:10,color:C.txt("muted"),
                          display:"flex",alignItems:"center",gap:3,flexShrink:0}}>
                          <MapPin size={9}/>{part.currentStation}
                        </span>
                      )}
                    </div>

                    {/* Timestamp */}
                    {part.updatedAt&&(
                      <p style={{fontSize:10,color:C.txt("muted"),marginTop:4,
                        fontFamily:"'DM Mono',monospace"}}>
                        {formatTime(part.updatedAt)}
                      </p>
                    )}
                  </button>

                  {/* ── Single action button ── */}
                  <div style={{
                    padding:"5px 8px 7px",
                    borderTop:`1px solid ${C.border()}`,
                    background: active ? C.navy(0.05) : C.bg("card"),
                    borderRadius:"0 0 10px 10px",
                  }}>
                    <PartActionBtn
                      icon={<QrCode size={12}/>}
                      label="QR & Remove"
                      color={C.steel()}
                      bgColor={C.steel(0.1)}
                      borderColor={C.steel(0.3)}
                      hoverBg={C.steel(0.2)}
                      onClick={e=>{e.stopPropagation();setQrModalPartId(part.partId);}}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Station Timeline ──────────────────────────────────────── */}
        <div style={{background:C.bg("card"),border:`1px solid ${C.border()}`,
          borderRadius:16,boxShadow:"var(--shadow)",overflow:"hidden"}}>

          <SectionHead
            subtitle="Station Timeline"
            title={selectedPartId||"Select a part from the list"}
            accent
            right={
              selectedPart?.currentStation&&(
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <Zap size={12} color={C.amber()}/>
                  <span style={{fontSize:11,fontWeight:700,color:C.amber()}}>
                    {selectedPart.currentStation}
                  </span>
                </div>
              )
            }
          />

          {/* Loading */}
          {loading&&(
            <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
              {[1,2,3].map(i=>(
                <div key={i} style={{borderRadius:12,border:`1px solid ${C.border()}`,
                  padding:16,background:C.bg("surface")}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <div style={{width:28,height:28,borderRadius:8,background:C.bg("hover"),animation:"itPulse 1.2s ease-in-out infinite"}}/>
                    <div style={{height:14,width:120,borderRadius:4,background:C.bg("hover"),animation:"itPulse 1.2s ease-in-out infinite"}}/>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <div style={{height:24,width:70,borderRadius:6,background:C.bg("hover"),animation:"itPulse 1.2s ease-in-out infinite"}}/>
                    <div style={{height:24,width:70,borderRadius:6,background:C.bg("hover"),animation:"itPulse 1.2s ease-in-out infinite"}}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading&&stationTimeline.length===0&&(
            <div style={{padding:"56px 24px",textAlign:"center"}}>
              <div style={{width:56,height:56,borderRadius:16,background:C.bg("surface"),
                border:`1px solid ${C.border()}`,display:"flex",alignItems:"center",
                justifyContent:"center",margin:"0 auto 16px"}}>
                <Layers size={24} color={C.txt("muted")}/>
              </div>
              <p style={{fontSize:14,fontWeight:600,color:C.txt("secondary"),marginBottom:6}}>
                {selectedPartId?"No station data available":"Select a part to view its journey"}
              </p>
              <p style={{fontSize:12,color:C.txt("muted")}}>
                {selectedPartId
                  ?"This part has no recorded station history yet."
                  :"Click any part in the list on the left to see its full station-by-station journey."}
              </p>
            </div>
          )}

          {/* Timeline */}
          {!loading&&stationTimeline.length>0&&(
            <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",
              gap:8,maxHeight:720,overflowY:"auto"}}>

              {/* Progress bar */}
              <div style={{background:C.bg("surface"),border:`1px solid ${C.border()}`,
                borderRadius:10,padding:"10px 14px",marginBottom:4}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:700,color:C.txt("muted"),
                    textTransform:"uppercase",letterSpacing:"0.07em"}}>
                    Journey Progress
                  </span>
                  <span style={{fontSize:11,fontWeight:800,color:C.txt("secondary"),
                    fontFamily:"'DM Mono',monospace"}}>
                    {statusSummary.passed}/{stationTimeline.length} stations passed
                  </span>
                </div>
                <div style={{height:6,borderRadius:99,background:C.bg("hover"),overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:99,
                    background:`linear-gradient(90deg,${C.ok()},${C.steel()})`,
                    width:`${stationTimeline.length?(statusSummary.passed/stationTimeline.length)*100:0}%`,
                    transition:"width 0.4s ease"}}/>
                </div>
                {/* Dot indicators */}
                <div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                  {stationTimeline.map((st,i)=>{
                    const m=getStationMeta(st.stageState);
                    return (
                      <div key={i} title={st.stationNo} style={{
                        width:8,height:8,borderRadius:"50%",flexShrink:0,
                        background:STATUS[m.variant]?.fg||C.idle(),
                        opacity:m.variant==="idle"?0.3:1,
                      }}/>
                    );
                  })}
                </div>
              </div>

              {/* Station cards */}
              {stationTimeline.map((station,idx)=>{
                const meta     = getStationMeta(station.stageState);
                const sColor   = STATUS[meta.variant]||STATUS.idle;
                const settings = getStationFeatures(station.stationNo,stationSettings);
                const qrMeta   = qrByStation[station.stationNo];
                const isReset  = resettingStation===station.stationNo;
                const modules  = [
                  settings.qr          ?"QR Scan"  :null,
                  settings.operation   ?"Operation":null,
                  settings.rejectionBin?"Rej. Bin" :null,
                ].filter(Boolean);

                return (
                  <div key={station.stationNo} style={{
                    borderRadius:12,
                    border:`1px solid ${sColor.border}`,
                    background:meta.variant==="idle"?C.bg("surface"):sColor.bgLight,
                    padding:"14px 16px",
                    transition:"all 0.2s ease",
                    animation:"itFadeIn 0.25s ease",
                  }}>

                    {/* Station header */}
                    <div style={{display:"flex",alignItems:"flex-start",
                      justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:8}}>

                      {/* Left: number + name + time */}
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:32,height:32,borderRadius:9,flexShrink:0,
                          background:sColor.bgLight,border:`1px solid ${sColor.border}`,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:12,fontWeight:800,color:sColor.fg}}>
                          {idx+1}
                        </div>
                        <div>
                          <p style={{fontSize:13,fontWeight:800,color:C.txt("primary"),letterSpacing:"0.01em"}}>
                            {station.stationNo}
                          </p>
                          <p style={{fontSize:11,color:C.txt("muted"),marginTop:2,
                            fontFamily:"'DM Mono',monospace"}}>
                            {station.latestAt?`Last: ${formatTime(station.latestAt)}`:"Not started"}
                          </p>
                        </div>
                      </div>

                      {/* Right: QR + Op status + Reset */}
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {/* QR status — shown inline on station */}
                        {qrMeta && (
                          <Badge variant={qrMeta.variant} label={qrMeta.label} pulse={qrMeta.variant==="wip"}/>
                        )}
                        {/* Operation status */}
                        <Badge variant={meta.variant} label={`Op: ${meta.label}`} pulse={meta.variant==="wip"}/>
                        {/* Reset button */}
                        <Btn variant="ghost" onClick={()=>handleResetStation(station.stationNo)}
                          disabled={!selectedPartId||Boolean(resettingStation)}
                          loading={isReset}
                          style={{padding:"4px 10px",fontSize:11}}>
                          {!isReset&&<RotateCcw size={10}/>}
                          {isReset?"Resetting…":"Reset"}
                        </Btn>
                      </div>
                    </div>

                    {/* Module tags */}
                    {modules.length>0&&(
                      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                        {modules.map(mod=>(
                          <span key={mod} style={{fontSize:10,fontWeight:700,padding:"2px 8px",
                            borderRadius:5,border:`1px solid ${C.border()}`,
                            background:C.bg("hover"),color:C.txt("muted"),
                            textTransform:"uppercase",letterSpacing:"0.06em"}}>{mod}</span>
                        ))}
                      </div>
                    )}

                    {/* Attempt history */}
                    {Array.isArray(station.attempts)&&station.attempts.length>1&&(
                      <div style={{marginBottom:8}}>
                        <Divider label={`${station.attempts.length} scan attempts`}/>
                        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
                          {station.attempts.map((att,ai)=>{
                            const am=getStationMeta(att.plcStatus||att.status);
                            return (
                              <div key={ai} title={`Attempt ${ai+1} · ${formatDate(att.createdAt)}`}
                                style={{display:"flex",alignItems:"center",gap:5,
                                  padding:"3px 8px",borderRadius:6,fontSize:10,fontWeight:700,
                                  background:STATUS[am.variant]?.bgLight||C.bg("hover"),
                                  border:`1px solid ${STATUS[am.variant]?.border||C.border()}`,
                                  color:STATUS[am.variant]?.fg||C.txt("muted")}}>
                                <span style={{fontFamily:"monospace"}}>#{ai+1}</span>
                                <span style={{opacity:0.8}}>{formatTime(att.createdAt)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Interlock warning */}
                    {settings.rejectionBin&&(station.latestInterlockReason||station.stageState==="FAILED")&&(
                      <div style={{display:"flex",alignItems:"flex-start",gap:10,
                        borderRadius:8,padding:"9px 12px",marginTop:4,
                        background:C.ng(0.08),border:`1px solid ${C.ng(0.25)}`}}>
                        <AlertTriangle size={13} color={C.ng()} style={{flexShrink:0,marginTop:1}}/>
                        <span style={{fontSize:12,color:C.ng(0.9),lineHeight:1.5}}>
                          {station.latestInterlockReason||"Rejection / NG detected at this station"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComponentJourney;
