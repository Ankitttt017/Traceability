// ============================================================
//  OperatorView.jsx — IndusTrace Premium Redesign
//  Color Theme: Navy / Steel / Amber / Linen
//  Clean professional layout — operator-friendly
//  No override/jargon — simple readable labels
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertTriangle, CheckCircle2, Clock3, Factory,
  Gauge, RefreshCw, ShieldCheck, Wrench,
  Wifi, WifiOff, Activity, TrendingUp,
  BarChart2, Target, Cpu, Radio,
} from "lucide-react";
import { machineApi, stationSettingsApi, traceabilityApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import ConfirmModal from "../components/ConfirmModal";
import { getMachineStage } from "../utils/machineFields";
import { getStationFeatureSettings, getStationFeatures, saveStationFeatureSettings } from "../utils/stationSettings";

const SOCKET_URL             = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const LIVE_REFRESH_COOLDOWN  = 350;
const QR_EVENT_DEDUPE_MS     = 3000;
const POPUP_EVENT_DEDUPE_MS  = 1800;
const QR_STORAGE_KEY         = "operator-last-qr-signal";

// ── Design tokens ─────────────────────────────────────────────────────────
const DS = `
  @keyframes ovSpin   { to{transform:rotate(360deg)} }
  @keyframes ovFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes ovPulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes ovPing   { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.2);opacity:0} }
  :root{
    --ov-navy:  26,50,99;   --ov-steel: 84,119,146;
    --ov-amber: 250,185,91; --ov-linen: 232,226,219;
    --ov-ok:    34,197,94;  --ov-ng:    239,68,68;
    --ov-wip:   249,115,22; --ov-idle:  148,163,184;
  }
  [data-theme="light"]{
    --ov-bg-card:   255,255,255; --ov-bg-surf:  240,236,230;
    --ov-bg-input:  255,255,255;
    --ov-txt-pri:   26,50,99;    --ov-txt-sec:  84,119,146;
    --ov-txt-muted: 140,160,180;
    --ov-bdr: 84,119,146; --ov-bop: 0.14;
  }
  [data-theme="dark"]{
    --ov-bg-card:   20,34,62;  --ov-bg-surf:  16,26,50;
    --ov-bg-input:  14,22,44;
    --ov-txt-pri:   232,226,219; --ov-txt-sec: 120,160,190;
    --ov-txt-muted: 84,119,146;
    --ov-bdr: 84,119,146; --ov-bop: 0.18;
  }
`;
let _ovDS = false;
function injectDS() {
  if (_ovDS||typeof document==="undefined") return;
  _ovDS=true;
  const el=document.createElement("style"); el.textContent=DS; document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme","dark");
}

const C = {
  navy:  (o=1) => `rgba(var(--ov-navy),${o})`,
  steel: (o=1) => `rgba(var(--ov-steel),${o})`,
  amber: (o=1) => `rgba(var(--ov-amber),${o})`,
  linen: (o=1) => `rgba(var(--ov-linen),${o})`,
  ok:    (o=1) => `rgba(var(--ov-ok),${o})`,
  ng:    (o=1) => `rgba(var(--ov-ng),${o})`,
  wip:   (o=1) => `rgba(var(--ov-wip),${o})`,
  idle:  (o=1) => `rgba(var(--ov-idle),${o})`,
  bg:    (v="card") => `rgb(var(--ov-bg-${v}))`,
  txt:   (v="pri")  => `rgb(var(--ov-txt-${v}))`,
  bdr:   (o)        => `rgba(var(--ov-bdr),${o||"var(--ov-bop)"})`,
};
const SH  = `0 2px 12px rgba(var(--ov-navy),.08),0 1px 3px rgba(var(--ov-navy),.05)`;
const SHM = `0 4px 20px rgba(var(--ov-navy),.14),0 2px 6px rgba(var(--ov-navy),.07)`;

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
    id:`${Date.now()}-${Math.random()}`,
    label:isPass?"QR PASS":isFail?"QR FAIL":"QR WAIT",
    variant:isPass?"ok":isFail?"ng":"idle",
    partId:normalizePartId(payload.partId||payload.part_id),
    stationNo:String(payload.stationNo||payload.station_no||"").trim().toUpperCase(),
    decision:d,
    reason:String(payload.reason||payload.qrReason||"").trim(),
    message:String(payload.message||"").trim(),
    timestamp:payload.timestamp||new Date().toISOString(),
  };
}
function formatScanErrorMessage(payload={}) {
  const reason=String(payload.reason||"").trim().toUpperCase();
  const station=String(payload.stationNo||payload.station_no||"").trim().toUpperCase();
  const expected=String(payload.expectedStation||payload.expected_station||"").trim().toUpperCase();
  if (reason==="DUPLICATE_SCAN") return `Duplicate scan at ${station||"station"}. Reset required before re-scan.`;
  if (reason==="RESET_REQUIRED_AFTER_PLC_COMM_ERROR") return `Previous PLC cycle timed out at ${station||"station"}. Use Reset Operation, then scan again.`;
  if (reason.startsWith("PLC_TIMEOUT")) return "PLC response timeout. Use Reset Operation, then scan again.";
  if (reason==="PREVIOUS_STATION_NOT_COMPLETED") return expected?`Station sequence error. Complete ${expected} first.`:"Station sequence error. Previous station not completed.";
  if (reason==="INVALID_QR_FORMAT") return String(payload.message||"").trim()||"Invalid QR format. Scan correct component code.";
  if (reason==="QR_RULE_CONFIG_ERROR") return String(payload.message||"").trim()||"QR rule configuration is invalid. Contact supervisor.";
  if (reason==="ALREADY_COMPLETED") return "Part already completed. Re-scan is not allowed.";
  if (reason==="PART_INTERLOCKED") return "Part interlocked. Reset required from control flow.";
  if (reason==="STATION_NOT_CONFIGURED") return "Station not configured in machine master. Contact supervisor.";
  if (reason==="INVALID_INPUT") return "Invalid scan input. Re-scan the QR code.";
  if (reason==="SCAN_RESULT_NG") return "QR validation failed (NG). Send part to rejection flow.";
  if (reason) return reason.replaceAll("_"," ");
  return String(payload.message||"Scan blocked");
}
function shouldSuppressPopupPayload(payload={}) {
  const partId=normalizePartId(payload.partId||payload.part_id);
  const station=String(payload.stationNo||payload.station_no||"").trim();
  const message=String(payload.message||payload.error||"").trim().toUpperCase();
  if (!partId&&!station&&!message) return true;
  if (!partId&&message.includes("PART NOT FOUND")) return true;
  return false;
}
function normalizeDecisionState(value) {
  const n=String(value||"").trim().toUpperCase();
  if (["ALLOW","PASS","OK","ACCEPT","VALID"].includes(n)) return "PASS";
  if (["BLOCK","FAIL","NG","REJECT","INVALID"].includes(n)) return "FAIL";
  if (n==="WAIT") return "WAIT";
  return "";
}
function isResetLikePayload(payload={}) {
  const status=String(payload.status||payload.plcStatus||payload.plc_status||"").trim().toUpperCase();
  const reason=String(payload.reason||payload.qrReason||"").trim().toUpperCase();
  const message=String(payload.message||"").trim().toUpperCase();
  return status==="RESET"||reason.includes("RESET")||message.includes("RESET");
}
function getOperationVariant(status) {
  const s=String(status||"").trim().toUpperCase();
  if (s==="ENDED_OK"||s==="PASSED")           return "ok";
  if (["ENDED_NG","INTERLOCKED","FAILED"].includes(s)) return "ng";
  if (["PLC_COMM_ERROR","COMM_ERROR"].includes(s))     return "wip";
  if (["STARTED","PENDING","IN_PROGRESS"].includes(s)) return "wip";
  return "idle";
}
function getOperationLabel(status) {
  const s=String(status||"").trim().toUpperCase();
  if (s==="ENDED_OK"||s==="PASSED")           return "Pass";
  if (["ENDED_NG","INTERLOCKED","FAILED"].includes(s)) return "Fail";
  if (["PLC_COMM_ERROR","COMM_ERROR"].includes(s))     return "Comm Error";
  if (["STARTED","PENDING","IN_PROGRESS"].includes(s)) return "Running";
  return "Waiting";
}
function fmtTime(v) { if(!v) return "—"; const d=new Date(v); return isNaN(d)?"—":d.toLocaleTimeString(); }
function fmtDT(v)   { if(!v) return "—"; const d=new Date(v); return isNaN(d)?"—":d.toLocaleString(); }
function formatElapsed(timestamp,now) {
  if (!timestamp) return "0m 00s";
  const s=String(timestamp||""); if (!s) return "0m 00s";
  const start=new Date(s).getTime(); if (isNaN(start)) return "0m 00s";
  const diff=Math.max(0,Math.floor((now-start)/1000));
  const h=Math.floor(diff/3600), m=Math.floor((diff%3600)/60), sec=diff%60;
  if (h>0) return `${h}h ${m}m ${String(sec).padStart(2,"0")}s`;
  return `${m}m ${String(sec).padStart(2,"0")}s`;
}

// ── Atoms ──────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  ok:   {fg:C.ok(),   bg:C.ok(0.1),   bd:C.ok(0.28)  },
  ng:   {fg:C.ng(),   bg:C.ng(0.1),   bd:C.ng(0.28)  },
  wip:  {fg:C.wip(),  bg:C.wip(0.1),  bd:C.wip(0.28) },
  idle: {fg:C.idle(), bg:C.idle(0.08),bd:C.idle(0.2) },
};

const Badge = ({ variant="idle", label, pulse, size="sm" }) => {
  const s=STATUS_MAP[variant]||STATUS_MAP.idle;
  return (
    <span style={{
      display:"inline-flex",alignItems:"center",gap:5,
      padding:size==="lg"?"5px 14px":"3px 10px",
      borderRadius:99,
      fontSize:size==="lg"?13:11,fontWeight:700,
      letterSpacing:"0.04em",
      color:s.fg,background:s.bg,border:`1px solid ${s.bd}`,
      whiteSpace:"nowrap",
    }}>
      <span style={{width:size==="lg"?8:5,height:size==="lg"?8:5,
        borderRadius:"50%",background:s.fg,flexShrink:0,
        animation:pulse?"ovPulse 1.2s ease-in-out infinite":"none"}}/>
      {label}
    </span>
  );
};

// Connection dot with ping
const ConnDot = ({ connected }) => (
  <div style={{position:"relative",width:10,height:10,flexShrink:0}}>
    {connected&&(
      <div style={{position:"absolute",inset:0,borderRadius:"50%",
        background:C.ok(0.4),animation:"ovPing 1.8s ease-out infinite"}}/>
    )}
    <div style={{width:10,height:10,borderRadius:"50%",position:"relative",
      background:connected?C.ok():C.ng()}}/>
  </div>
);

// Info row in sidebar cards
const InfoRow = ({ label, value, mono, valueColor }) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
    gap:8,padding:"5px 0",borderBottom:`1px solid ${C.bdr()}`}}>
    <span style={{fontSize:11,color:C.txt("muted"),fontWeight:600,flexShrink:0}}>{label}</span>
    <span style={{
      fontSize:11,fontWeight:700,
      color:valueColor||C.txt("pri"),
      fontFamily:mono?"'DM Mono',monospace":"inherit",
      textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
      maxWidth:160,
    }}>{value||"—"}</span>
  </div>
);

// Section card shell
const Card = ({ title, icon:Icon, accent, children, right, noPad }) => (
  <div style={{
    background:C.bg("card"),border:`1px solid ${C.bdr()}`,
    borderRadius:14,overflow:"hidden",boxShadow:SH,
    borderLeft:accent?`3px solid ${accent}`:"none",
  }}>
    {(title||right)&&(
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.bdr()}`,
        background:C.bg("surf"),display:"flex",alignItems:"center",
        justifyContent:"space-between",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          {Icon&&<Icon size={14} color={C.steel()}/>}
          <p style={{fontSize:13,fontWeight:700,color:C.txt("pri")}}>{title}</p>
        </div>
        {right}
      </div>
    )}
    <div style={noPad?{}:{padding:16}}>{children}</div>
  </div>
);

// Feature toggle row
const FeatureRow = ({ label, enabled }) => (
  <div style={{
    display:"flex",alignItems:"center",justifyContent:"space-between",
    padding:"8px 12px",borderRadius:8,
    background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
    marginBottom:5,
  }}>
    <span style={{fontSize:12,color:C.txt("pri")}}>{label}</span>
    <span style={{
      fontSize:11,fontWeight:700,
      color:enabled?C.ok():C.txt("muted"),
      padding:"2px 8px",borderRadius:99,
      background:enabled?C.ok(0.1):C.idle(0.08),
      border:`1px solid ${enabled?C.ok(0.25):C.bdr()}`,
    }}>
      {enabled?"Enabled":"Disabled"}
    </span>
  </div>
);

// Large decision display
const DecisionDisplay = ({ label, variant, sub1, sub2, accent }) => {
  const s=STATUS_MAP[variant]||STATUS_MAP.idle;
  return (
    <div style={{
      borderRadius:12,padding:"14px 16px",
      background:s.bg,border:`1px solid ${s.bd}`,
      borderLeft:accent?`3px solid ${s.fg}`:"none",
    }}>
      <p style={{fontSize:10,fontWeight:800,textTransform:"uppercase",
        letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:6}}>{label}</p>
      <p style={{fontSize:24,fontWeight:900,color:s.fg,lineHeight:1,
        fontFamily:"'DM Mono',monospace",marginBottom:6}}>{variant==="ok"?"✓ PASS":variant==="ng"?"✗ FAIL":variant==="wip"?"● RUNNING":"○ WAITING"}</p>
      {sub1&&<p style={{fontSize:11,color:C.txt("muted"),fontFamily:"'DM Mono',monospace",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub1}</p>}
      {sub2&&<p style={{fontSize:10,color:C.txt("muted"),overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub2}</p>}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
const OperatorView = () => {
  injectDS();

  const user = useMemo(()=>{ try{return JSON.parse(localStorage.getItem("user")||"{}");} catch{return{};} },[]);

  const [machines,         setMachines]         = useState([]);
  const [selectedMachineId,setSelectedMachineId]= useState("");
  const [liveState,        setLiveState]        = useState(null);
  const [stationStats,     setStationStats]     = useState(null);
  const [stationSettings,  setStationSettings]  = useState(()=>getStationFeatureSettings());
  const [loadingMachines,  setLoadingMachines]  = useState(true);
  const [loadingStats,     setLoadingStats]     = useState(false);
  const [refreshing,       setRefreshing]       = useState(false);
  const [popup,            setPopup]            = useState(null);
  const [qrSignal,         setQrSignal]         = useState(null);
  const [qrFeed,           setQrFeed]           = useState([]);
  const [resetConfirm,     setResetConfirm]     = useState(null);
  const [clockTick,        setClockTick]        = useState(Date.now());

  const selectedMachineIdRef = useRef("");
  const selectedStationRef   = useRef("");
  const liveRefreshTimerRef  = useRef(null);
  const lastLiveRefreshRef   = useRef(0);
  const lastQrEventRef       = useRef({key:"",at:0});
  const lastPopupEventRef    = useRef({key:"",at:0});

  const selectedMachine = useMemo(()=>machines.find(e=>e.id===Number(selectedMachineId))||null,[machines,selectedMachineId]);
  const selectedStation = useMemo(()=>getMachineStage(selectedMachine),[selectedMachine]);

  useEffect(()=>{ selectedMachineIdRef.current=String(selectedMachineId||""); },[selectedMachineId]);
  useEffect(()=>{ selectedStationRef.current=String(selectedStation||"").toUpperCase(); },[selectedStation]);

  const stationFeatureConfig = useMemo(()=>getStationFeatures(selectedStation,stationSettings),[selectedStation,stationSettings]);

  const qualitySummary = stationStats?.summary||{okCount:0,ngCount:0,interlockedCount:0,inProgressCount:0,processedCount:0,accuracy:0};
  const expectedCount  = Math.max(Number(qualitySummary.processedCount||0)+Number(qualitySummary.inProgressCount||0)+Number(qualitySummary.interlockedCount||0),1);
  const producedCount  = Number(qualitySummary.processedCount||0);
  const progressPct    = Math.min(100,Math.round((producedCount/expectedCount)*100));
  const qualityPct     = Number(qualitySummary.accuracy||0);
  const machineMode    = liveState?.current?"Running":liveState?.lastEvent?"Idle":"Waiting";
  const machineClock   = formatElapsed(liveState?.current?.createdAt||liveState?.lastEvent?.createdAt,clockTick);

  const currentContext  = liveState?.current||stationStats?.current||liveState?.lastEvent||stationStats?.lastEvent||null;
  const plcHealth       = liveState?.plcHealth||stationStats?.plcHealth||null;
  const scannerHealth   = liveState?.scannerHealth||stationStats?.scannerHealth||null;
  const scannerInfo     = liveState?.scanner||stationStats?.scanner||null;
  const plcConnected    = Boolean(plcHealth?.healthy);
  const scannerConfigured = String(scannerHealth?.status||"").toUpperCase()!=="NOT_CONFIGURED";
  const scannerConnected  = Boolean(scannerHealth?.connected);

  const opVariant = useMemo(()=>getOperationVariant(currentContext?.plcStatus),[currentContext?.plcStatus]);
  const opLabel   = useMemo(()=>getOperationLabel(currentContext?.plcStatus),[currentContext?.plcStatus]);

  const canQuickReset = useMemo(()=>{
    if (!currentContext?.partId||!selectedStation) return false;
    const s=String(currentContext?.plcStatus||"").trim().toUpperCase();
    return ["ENDED_NG","FAILED","NG","INTERLOCKED","PLC_COMM_ERROR","COMM_ERROR","TIMEOUT","PLC_TIMEOUT"].includes(s);
  },[currentContext?.partId,currentContext?.plcStatus,selectedStation]);

  const rejectionSummary = useMemo(()=>{
    const rows=stationStats?.recentParts||[];
    const grouped=rows.reduce((acc,row)=>{
      const hasR=Boolean(row.interlockReason)||String(row.result||"").toUpperCase()==="NG";
      const reason=hasR?row.interlockReason||"NG without reason":null;
      if (!reason) return acc;
      acc[reason]=(acc[reason]||0)+1;
      return acc;
    },{});
    return Object.entries(grouped).map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count).slice(0,5);
  },[stationStats?.recentParts]);

  const trendRows = useMemo(()=>[...(stationStats?.trend||[])].slice(-6),[stationStats?.trend]);

  // ── Data fetching (unchanged logic) ──────────────────────────────────
  const loadMachines = useCallback(async()=>{
    setLoadingMachines(true);
    try {
      const rows=await machineApi.list(); setMachines(rows||[]);
      if ((rows||[]).length>0) setSelectedMachineId(c=>c||String(rows[0].id));
      else setSelectedMachineId("");
    } catch(e){ setPopup({type:"ERROR",title:"Machine Load Failed",message:e.response?.data?.error||"Unable to load machines"}); }
    finally { setLoadingMachines(false); }
  },[]);

  const loadMachineTelemetry = useCallback(async(machineId,showLoader=true)=>{
    const id=Number(machineId||0);
    if (!id){ setLiveState(null); setStationStats(null); return; }
    if (showLoader) setLoadingStats(true); else setRefreshing(true);
    try {
      const [live,stats]=await Promise.all([traceabilityApi.liveState(id),traceabilityApi.machineStats(id)]);
      setLiveState(live||null); setStationStats(stats||null);
    } catch(e){ if (showLoader) setPopup({type:"ERROR",title:"Station Data Error",message:e.response?.data?.error||"Unable to load machine telemetry"}); }
    finally { setLoadingStats(false); setRefreshing(false); }
  },[]);

  const scheduleLiveRefresh = useCallback(()=>{
    const active=selectedMachineIdRef.current; if (!active) return;
    const elapsed=Date.now()-lastLiveRefreshRef.current;
    const delay=Math.max(0,LIVE_REFRESH_COOLDOWN-elapsed);
    if (liveRefreshTimerRef.current) return;
    liveRefreshTimerRef.current=setTimeout(()=>{
      liveRefreshTimerRef.current=null; lastLiveRefreshRef.current=Date.now();
      loadMachineTelemetry(active,false);
    },delay);
  },[loadMachineTelemetry]);

  const isDuplicatePopupEvent = useCallback((payload={})=>{
    const key=[String(payload.type||"").trim().toUpperCase(),normalizePartId(payload.partId||payload.part_id),
      String(payload.stationNo||payload.station_no||"").trim().toUpperCase(),
      normalizeDecisionState(payload.qrResult||payload.qr_result),
      String(payload.plcStatus||payload.plc_status||"").trim().toUpperCase(),
      String(payload.reason||payload.qrReason||"").trim().toUpperCase(),
      String(payload.message||"").trim().toUpperCase()].join("|");
    if (!key.replaceAll("|","")) return false;
    const now=Date.now();
    if (lastPopupEventRef.current.key===key&&now-lastPopupEventRef.current.at<POPUP_EVENT_DEDUPE_MS) return true;
    lastPopupEventRef.current={key,at:now}; return false;
  },[]);

  const processQrSignal = useCallback((payload={})=>{
    if (!hasQrDecision(payload)) return false;
    const pm=String(payload.machineId||payload.machine_id||"");
    const ps=String(payload.stationNo||payload.station_no||"").trim().toUpperCase();
    const am=selectedMachineIdRef.current, as_=selectedStationRef.current;
    if (!(pm&&pm===am)&&!(ps&&ps===as_)) return false;
    const sig=toQrSignal(payload);
    const dedupeR=["BLOCK","FAIL","NG","REJECT","INVALID"].includes(sig.decision)?sig.reason:"";
    const key=[sig.partId,sig.stationNo,sig.decision,dedupeR].join("|");
    const now=Date.now();
    if (lastQrEventRef.current.key===key&&now-lastQrEventRef.current.at<QR_EVENT_DEDUPE_MS) return false;
    lastQrEventRef.current={key,at:now};
    setQrSignal(sig); setQrFeed(prev=>[sig,...prev].slice(0,6));
    const mk=selectedMachineIdRef.current;
    if (mk){ try{ const c=JSON.parse(localStorage.getItem(QR_STORAGE_KEY)||"{}"); c[mk]=sig; localStorage.setItem(QR_STORAGE_KEY,JSON.stringify(c)); }catch{} }
    return true;
  },[]);

  const mergePopupPayload = useCallback((payload={})=>{
    setPopup(prev=>{
      const iqr=payload.qrResult||payload.qr_result||"", iqrS=normalizeDecisionState(iqr), pqrS=normalizeDecisionState(prev?.qrResult||prev?.qr_result||"");
      const iplc=payload.plcStatus||payload.plc_status||"", iplcS=String(iplc||"").trim().toUpperCase(), pplcS=String(prev?.plcStatus||prev?.plc_status||"").trim().toUpperCase();
      const rl=isResetLikePayload(payload);
      const applyQr=Boolean(iqr)&&(iqrS!=="WAIT"||!pqrS||pqrS==="WAIT"||rl);
      const applyPlc=Boolean(iplc)&&(iplcS!=="WAIT"||!pplcS||pplcS==="WAIT"||rl);
      return {
        ...prev,...(payload.type&&{type:payload.type}),...(payload.title&&{title:payload.title}),
        ...(applyQr&&{qrResult:iqr}),...(applyPlc&&{plcStatus:iplc}),
        ...(payload.message&&{message:payload.message}),...(payload.reason&&{reason:payload.reason}),
        ...(payload.expectedStation&&{expectedStation:payload.expectedStation}),
        ...((payload.partId||payload.part_id)&&{partId:payload.partId||payload.part_id}),
        ...((payload.stationNo||payload.station_no)&&{stationNo:payload.stationNo||payload.station_no}),
        ...((payload.machineId||payload.machine_id)&&{machineId:payload.machineId||payload.machine_id}),
        ...(payload.machineName&&{machineName:payload.machineName}),
        ...(payload.timestamp&&{timestamp:payload.timestamp}),
      };
    });
  },[]);

  const handleResetOperation = useCallback(async(partId,stationNo,options={})=>{
    const pid=normalizePartId(partId), sno=String(stationNo||"").trim().toUpperCase();
    if (!pid||!sno) return false;
    const res=await traceabilityApi.resetOperation({partId:pid,stationNo:sno});
    const mk=selectedMachineIdRef.current;
    if (mk){ try{ const c=JSON.parse(localStorage.getItem(QR_STORAGE_KEY)||"{}"); delete c[mk]; localStorage.setItem(QR_STORAGE_KEY,JSON.stringify(c)); }catch{} }
    setQrSignal(null); setQrFeed([]);
    mergePopupPayload({type:"INFO",partId:pid,stationNo:sno,qrResult:"WAIT",plcStatus:"WAIT",message:res?.message||"Operation reset successful"});
    scheduleLiveRefresh(); return true;
  },[mergePopupPayload,scheduleLiveRefresh]);

  const openResetConfirm = useCallback((partId, stationNo) => {
    const pid = normalizePartId(partId);
    const sno = String(stationNo || "").trim().toUpperCase();
    if (!pid || !sno) return;
    setResetConfirm({ partId: pid, stationNo: sno });
  }, []);

  const confirmResetOperation = useCallback(async () => {
    const pid = normalizePartId(resetConfirm?.partId);
    const sno = String(resetConfirm?.stationNo || "").trim().toUpperCase();
    if (!pid || !sno) {
      setResetConfirm(null);
      return;
    }
    try {
      await handleResetOperation(pid, sno, { confirmed: true });
    } catch (e) {
      mergePopupPayload({
        type: "ERROR",
        title: "Reset Failed",
        message: e.response?.data?.error || "Unable to reset",
        partId: pid,
        stationNo: sno,
      });
    } finally {
      setResetConfirm(null);
    }
  }, [handleResetOperation, mergePopupPayload, resetConfirm]);

  useEffect(()=>{ loadMachines(); },[loadMachines]);
  useEffect(()=>{ if (!selectedMachineId) return; loadMachineTelemetry(selectedMachineId,true); },[selectedMachineId,loadMachineTelemetry]);
  useEffect(()=>{ const t=setInterval(()=>{ if (selectedMachineIdRef.current) loadMachineTelemetry(selectedMachineIdRef.current,false); },15000); return()=>clearInterval(t); },[loadMachineTelemetry]);
  useEffect(()=>{ const t=setInterval(()=>setClockTick(Date.now()),1000); return()=>clearInterval(t); },[]);

  useEffect(()=>{
    const sync=async()=>{
      try{ const r=await stationSettingsApi.list(); if (r&&Object.keys(r).length>0){setStationSettings(r);saveStationFeatureSettings(r);return;} }catch{}
      setStationSettings(getStationFeatureSettings());
    };
    sync();
    const onFocus=()=>sync(), onStorage=()=>setStationSettings(getStationFeatureSettings());
    window.addEventListener("focus",onFocus); window.addEventListener("storage",onStorage);
    return()=>{ window.removeEventListener("focus",onFocus); window.removeEventListener("storage",onStorage); };
  },[]);

  useEffect(()=>{
    const socket=io(SOCKET_URL,{path:"/socket.io/",transports:["websocket","polling"]});
    socket.on("scan_event",(p={})=>{
      const rel=processQrSignal(p);
      if (rel){ const d=extractQrDecision(p); if (d==="BLOCK"){ if (isDuplicatePopupEvent({...p,type:"ERROR"})){scheduleLiveRefresh();return;} if (shouldSuppressPopupPayload(p)){scheduleLiveRefresh();return;} mergePopupPayload({type:"ERROR",title:"Scan Blocked",message:formatScanErrorMessage(p),reason:p.reason||"",partId:p.partId||p.part_id,stationNo:p.stationNo||p.station_no,machineId:p.machineId||p.machine_id,qrResult:"FAIL",plcStatus:"WAIT",timestamp:p.timestamp}); } scheduleLiveRefresh(); }
    });
    socket.on("journey_update",(p={})=>{ if (String(p.sourceEvent||"").toLowerCase()==="scan_event") return; if (hasQrDecision(p)&&processQrSignal(p)) scheduleLiveRefresh(); });
    socket.on("operator_popup",(p={})=>{
      if (shouldSuppressPopupPayload(p)||isDuplicatePopupEvent(p)) return;
      const ps=String(p.stationNo||p.station_no||"").trim().toUpperCase(), pm=String(p.machineId||p.machine_id||"");
      if (!(pm===selectedMachineIdRef.current||(ps&&ps===selectedStationRef.current))) return;
      const nm=String(p.type||"").toUpperCase()==="ERROR"&&String(p.reason||p.qrReason||"").trim()?formatScanErrorMessage({...p,reason:p.reason||p.qrReason}):p.message;
      mergePopupPayload({...p,...(nm?{message:nm}:{})});
      if (hasQrDecision(p)||String(p.sourceEvent||"").toLowerCase()==="scan_event") processQrSignal(p);
      scheduleLiveRefresh();
    });
    socket.on("dashboard_refresh",()=>scheduleLiveRefresh());
    socket.on("plc_health",(p={})=>{ if (String(p.machineId||p.machine_id||"")===selectedMachineIdRef.current) scheduleLiveRefresh(); });
    socket.on("scanner_health",(p={})=>{ if (String(p.machineId||p.machine_id||"")===selectedMachineIdRef.current) scheduleLiveRefresh(); });
    return()=>{ if (liveRefreshTimerRef.current){clearTimeout(liveRefreshTimerRef.current);liveRefreshTimerRef.current=null;} socket.disconnect(); };
  },[scheduleLiveRefresh,processQrSignal,mergePopupPayload,isDuplicatePopupEvent]);

  useEffect(()=>{
    const mk=String(selectedMachineId||"");
    if (!mk){setQrSignal(null);setQrFeed([]);return;}
    try{ const saved=JSON.parse(localStorage.getItem(QR_STORAGE_KEY)||"{}"); const r=saved[mk]||null; if (r){setQrSignal(r);setQrFeed([r]);return;} }catch{}
    setQrSignal(null); setQrFeed([]);
  },[selectedMachineId]);

  useEffect(()=>{
    if (qrSignal||!currentContext?.partId) return;
    const s=String(currentContext?.plcStatus||"").trim().toUpperCase();
    if (!["PENDING","STARTED","ENDED_OK","ENDED_NG","PLC_COMM_ERROR"].includes(s)) return;
    const inferred={id:`${Date.now()}-inferred`,label:"QR PASS",variant:"ok",partId:normalizePartId(currentContext.partId),stationNo:String(selectedStation||"").trim().toUpperCase(),decision:"ALLOW",reason:"QR_VALIDATED",message:"Restored from station state",timestamp:currentContext.createdAt||new Date().toISOString()};
    setQrSignal(inferred); setQrFeed(prev=>prev.length?prev:[inferred]);
    const mk=String(selectedMachineIdRef.current||"");
    if (mk){ try{ const c=JSON.parse(localStorage.getItem(QR_STORAGE_KEY)||"{}"); c[mk]=inferred; localStorage.setItem(QR_STORAGE_KEY,JSON.stringify(c)); }catch{} }
  },[currentContext?.partId,currentContext?.plcStatus,currentContext?.createdAt,selectedStation,qrSignal]);

  // ─────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,paddingBottom:32,animation:"ovFadeIn .3s ease"}}>
      <GlobalPopup popup={popup} onClose={()=>setPopup(null)}
        onResetOperation={handleResetOperation}
        autoCloseMs={3500} criticalAutoCloseMs={9000} showAcknowledge={false}/>

      {/* ── Page Header ───────────────────────────────────────────── */}
      <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
        borderRadius:16,padding:"16px 20px",boxShadow:SH,overflow:"hidden"}}>
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,
          margin:"-16px -20px 14px"}}/>

        <div style={{display:"flex",alignItems:"flex-start",
          justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          {/* Machine info */}
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:48,height:48,borderRadius:13,flexShrink:0,
              background:`linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
              display:"flex",alignItems:"center",justifyContent:"center",
              boxShadow:`0 4px 12px ${C.navy(0.35)}`}}>
              <Factory size={22} color={C.linen()}/>
            </div>
            <div>
              <h1 style={{fontSize:18,fontWeight:800,color:C.txt("pri"),
                letterSpacing:"-0.02em",lineHeight:1.2}}>
                {selectedMachine?.machineName||"Select a Machine"}
              </h1>
              <p style={{fontSize:12,color:C.txt("muted"),marginTop:3}}>
                {selectedMachine?.lineName||"—"}
                {selectedStation&&<> · Station <span style={{color:C.amber(),fontWeight:700}}>{selectedStation}</span></>}
                {" · "}
                <span style={{color:machineMode==="Running"?C.ok():machineMode==="Idle"?C.amber():C.idle()}}>
                  {machineMode}
                </span>
                {" · "}{machineClock}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            {/* Machine selector */}
            <div style={{minWidth:220}}>
              <select value={selectedMachineId}
                onChange={e=>setSelectedMachineId(e.target.value)}
                disabled={loadingMachines}
                style={{
                  height:38,padding:"0 12px",width:"100%",
                  background:C.bg("input"),border:`1px solid ${C.bdr()}`,
                  borderRadius:9,fontSize:13,color:C.txt("pri"),
                  outline:"none",fontFamily:"'DM Sans',sans-serif",
                }}>
                {machines.map(m=>(
                  <option key={m.id} value={m.id}>
                    {m.machineName} — {m.operationNo}
                  </option>
                ))}
                {machines.length===0&&<option value="">No machine available</option>}
              </select>
            </div>

            {/* Refresh */}
            <button onClick={()=>selectedMachineId&&loadMachineTelemetry(selectedMachineId,false)}
              disabled={loadingStats||refreshing||!selectedMachineId}
              style={{
                display:"inline-flex",alignItems:"center",gap:6,
                height:38,padding:"0 14px",borderRadius:9,
                fontSize:12,fontWeight:700,cursor:"pointer",
                background:"transparent",border:`1px solid ${C.bdr()}`,
                color:C.txt("sec"),transition:"all .15s",
                opacity:loadingStats||!selectedMachineId?0.5:1,
              }}>
              <RefreshCw size={13} style={{animation:refreshing?"ovSpin .9s linear infinite":"none"}}/>
              {refreshing?"Updating…":"Refresh"}
            </button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {(loadingStats||loadingMachines)&&(
        <div style={{padding:"32px 24px",textAlign:"center",
          background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14,
          color:C.txt("muted"),fontSize:13}}>
          <RefreshCw size={20} color={C.txt("muted")}
            style={{margin:"0 auto 12px",animation:"ovSpin .9s linear infinite"}}/>
          Loading station data…
        </div>
      )}

      {!loadingStats&&!loadingMachines&&(
        <>
          {/* ── Row 1: Status + Gauge + Station Rules ─────────────── */}
          <div style={{display:"grid",gridTemplateColumns:"280px 1fr 260px",gap:16,alignItems:"start"}}>

            {/* ── Left: Station Status ─────────────────────────────── */}
            <div style={{display:"flex",flexDirection:"column",gap:12}}>

              {/* Connection status */}
              <Card title="Connections" icon={Wifi} accent={C.steel()}>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {/* PLC */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"9px 11px",borderRadius:9,
                    background:plcConnected?C.ok(0.07):C.ng(0.07),
                    border:`1px solid ${plcConnected?C.ok(0.22):C.ng(0.22)}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <ConnDot connected={plcConnected}/>
                      <div>
                        <p style={{fontSize:12,fontWeight:700,color:C.txt("pri")}}>PLC Controller</p>
                        <p style={{fontSize:10,color:C.txt("muted"),fontFamily:"'DM Mono',monospace"}}>
                          {plcHealth?.ip||"—"}
                        </p>
                      </div>
                    </div>
                    <Badge variant={plcConnected?"ok":"ng"} label={plcConnected?"Online":"Offline"} pulse={plcConnected}/>
                  </div>

                  {/* Scanner */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"9px 11px",borderRadius:9,
                    background:!scannerConfigured?C.idle(0.07):scannerConnected?C.ok(0.07):C.ng(0.07),
                    border:`1px solid ${!scannerConfigured?C.bdr():scannerConnected?C.ok(0.22):C.ng(0.22)}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <ConnDot connected={scannerConnected}/>
                      <div>
                        <p style={{fontSize:12,fontWeight:700,color:C.txt("pri")}}>
                          {scannerInfo?.scannerName||"Scanner"}
                        </p>
                        <p style={{fontSize:10,color:C.txt("muted"),fontFamily:"'DM Mono',monospace"}}>
                          {scannerInfo?.scannerIp||scannerHealth?.scannerIp||"—"}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={!scannerConfigured?"idle":scannerConnected?"ok":"ng"}
                      label={!scannerConfigured?"Not Set":scannerConnected?"Online":"Offline"}
                      pulse={scannerConnected}
                    />
                  </div>

                  {scannerConfigured&&(
                    <div style={{fontSize:10,color:C.txt("muted"),padding:"0 2px"}}>
                      <p>Connected: {fmtTime(scannerHealth?.connectedAt)}</p>
                      <p>Last data: {fmtTime(scannerHealth?.lastDataAt||scannerHealth?.lastSeenAt)}</p>
                    </div>
                  )}
                </div>
              </Card>

              {/* QR Decision */}
              <Card title="QR Result" icon={Radio} accent={STATUS_MAP[qrSignal?.variant||"idle"]?.fg}>
                <DecisionDisplay
                  label="Last QR Scan"
                  variant={qrSignal?.variant||"idle"}
                  sub1={qrSignal?.partId||currentContext?.partId||"Waiting for scan…"}
                  sub2={(qrSignal?.reason||qrSignal?.message||"")+(qrSignal?.timestamp?` · ${fmtTime(qrSignal.timestamp)}`:"") || fmtDT(currentContext?.createdAt)}
                  accent
                />
              </Card>

              {/* Operation Decision */}
              <Card title="Operation Result" icon={Activity} accent={STATUS_MAP[opVariant]?.fg}>
                <DecisionDisplay
                  label="PLC Operation Status"
                  variant={opVariant}
                  sub1={currentContext?.partId||"—"}
                  sub2={(currentContext?.interlockReason||currentContext?.result||"")+(currentContext?.createdAt?` · ${fmtTime(currentContext.createdAt)}`:"")}
                  accent
                />
                {canQuickReset&&(
                  <button onClick={()=>openResetConfirm(currentContext.partId,selectedStation)}
                    style={{
                      width:"100%",marginTop:12,height:38,
                      background:C.ng(),color:"white",
                      border:"none",borderRadius:9,
                      fontSize:12,fontWeight:800,cursor:"pointer",
                      display:"flex",alignItems:"center",justifyContent:"center",gap:6,
                      boxShadow:`0 3px 10px ${C.ng(0.3)}`,transition:"filter .15s",
                    }}
                    onMouseEnter={e=>e.currentTarget.style.filter="brightness(1.08)"}
                    onMouseLeave={e=>e.currentTarget.style.filter="none"}>
                    <RefreshCw size={13}/> Reset Operation
                  </button>
                )}
              </Card>
            </div>

            {/* ── Center: Production Gauge ──────────────────────────── */}
            <Card title="Production Overview" icon={Gauge} accent={C.amber()}>
              {/* Radial gauge */}
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"8px 0 16px"}}>
                <div style={{position:"relative",width:180,height:180}}>
                  {/* SVG radial gauge */}
                  <svg width={180} height={180} viewBox="0 0 180 180">
                    <circle cx={90} cy={90} r={72} fill="none"
                      stroke={C.bdr(0.3)} strokeWidth={14}/>
                    <circle cx={90} cy={90} r={72} fill="none"
                      stroke={qualityPct>=85?C.ok():qualityPct>=60?C.amber():C.ng()}
                      strokeWidth={14} strokeLinecap="round"
                      strokeDasharray={`${2*Math.PI*72}`}
                      strokeDashoffset={`${2*Math.PI*72*(1-progressPct/100)}`}
                      transform="rotate(-90 90 90)"
                      style={{transition:"stroke-dashoffset .8s ease"}}/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",
                    flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <p style={{fontSize:36,fontWeight:900,color:C.txt("pri"),
                      fontFamily:"'DM Mono',monospace",lineHeight:1}}>{progressPct}%</p>
                    <p style={{fontSize:10,color:C.txt("muted"),marginTop:4,
                      textTransform:"uppercase",letterSpacing:"0.08em"}}>Shift Progress</p>
                    <p style={{fontSize:12,fontWeight:700,color:C.steel(),marginTop:4}}>
                      Quality {qualityPct}%
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{width:"100%",maxWidth:360,marginTop:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",
                    fontSize:11,color:C.txt("muted"),marginBottom:5}}>
                    <span>Produced: {producedCount}</span>
                    <span>Expected: {expectedCount}</span>
                  </div>
                  <div style={{height:8,borderRadius:99,
                    background:C.bdr(0.2),overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:99,
                      background:`linear-gradient(90deg,${C.ok()},${C.steel()})`,
                      width:`${progressPct}%`,transition:"width .5s ease"}}/>
                  </div>
                </div>
              </div>

              {/* OK / NG counters */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
                {[
                  {label:"Pass (OK)",    value:qualitySummary.okCount||0,          color:C.ok(),   bg:C.ok(0.08),   bd:C.ok(0.2)  },
                  {label:"Fail (NG)",    value:qualitySummary.ngCount||0,           color:C.ng(),   bg:C.ng(0.08),   bd:C.ng(0.2)  },
                  {label:"Interlocked",  value:qualitySummary.interlockedCount||0,  color:C.amber(),bg:C.amber(0.08),bd:C.amber(0.2)},
                  {label:"In Progress",  value:qualitySummary.inProgressCount||0,  color:C.steel(),bg:C.steel(0.08),bd:C.steel(0.2)},
                ].map((s,i)=>(
                  <div key={i} style={{borderRadius:10,padding:"10px 8px",textAlign:"center",
                    background:s.bg,border:`1px solid ${s.bd}`}}>
                    <p style={{fontSize:20,fontWeight:800,color:s.color,
                      fontFamily:"'DM Mono',monospace",lineHeight:1,marginBottom:4}}>
                      {s.value}
                    </p>
                    <p style={{fontSize:9,fontWeight:700,color:C.txt("muted"),
                      textTransform:"uppercase",letterSpacing:"0.07em"}}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Operator + station info */}
              <div style={{background:C.bg("surf"),borderRadius:10,
                border:`1px solid ${C.bdr()}`,padding:"10px 14px"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
                  <InfoRow label="Operator" value={user.username||"Operator"}/>
                  <InfoRow label="Status" value={currentContext?.plcStatus||"WAITING"}/>
                  <InfoRow label="Last Part" value={currentContext?.partId} mono/>
                  <InfoRow label="Updated" value={fmtTime(currentContext?.createdAt)}/>
                </div>
              </div>
            </Card>

            {/* ── Right: Station Rules ──────────────────────────────── */}
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <Card title="Station Configuration" icon={ShieldCheck} accent={C.steel()}>
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  <FeatureRow label="QR Validation"      enabled={stationFeatureConfig.qr}/>
                  <FeatureRow label="Operation Rule"     enabled={stationFeatureConfig.operation}/>
                  <FeatureRow label="Rejection Bin"      enabled={stationFeatureConfig.rejectionBin}/>
                  <FeatureRow label="PLC Confirmation"   enabled={stationFeatureConfig.plcConfirmation}/>
                  <FeatureRow label="Manual OK / NG"     enabled={stationFeatureConfig.manualResult}/>
                  <FeatureRow label="Final Pack Station" enabled={stationFeatureConfig.finalPacking}/>
                </div>
              </Card>

              {/* Rejection summary */}
              <Card title="Rejection Summary" icon={AlertTriangle} accent={C.ng()}>
                {!stationFeatureConfig.rejectionBin ? (
                  <p style={{fontSize:12,color:C.txt("muted"),fontStyle:"italic"}}>
                    Rejection Bin is disabled for this station.
                  </p>
                ) : rejectionSummary.length===0 ? (
                  <div style={{display:"flex",alignItems:"center",gap:8,
                    padding:"8px 10px",borderRadius:8,
                    background:C.ok(0.07),border:`1px solid ${C.ok(0.2)}`}}>
                    <CheckCircle2 size={14} color={C.ok()}/>
                    <p style={{fontSize:12,color:C.ok(),fontWeight:600}}>
                      No rejections in recent events
                    </p>
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {rejectionSummary.map(e=>(
                      <div key={e.reason} style={{
                        display:"flex",alignItems:"center",justifyContent:"space-between",
                        padding:"7px 10px",borderRadius:8,
                        background:C.ng(0.07),border:`1px solid ${C.ng(0.18)}`}}>
                        <span style={{fontSize:11,color:C.txt("pri"),
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                          flex:1}}>{e.reason}</span>
                        <span style={{
                          fontSize:12,fontWeight:800,color:C.ng(),
                          fontFamily:"'DM Mono',monospace",
                          background:C.ng(0.12),padding:"2px 8px",
                          borderRadius:5,border:`1px solid ${C.ng(0.25)}`,
                          flexShrink:0,marginLeft:8,
                        }}>{e.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* ── Row 2: Hourly Trend + Recent Events ───────────────── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>

            {/* Hourly trend */}
            <Card title="Hourly Production Trend" icon={BarChart2} accent={C.steel()}>
              {trendRows.length===0 ? (
                <p style={{fontSize:12,color:C.txt("muted")}}>No trend data for this station.</p>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {trendRows.map(row=>{
                    const okPct = row.total>0?Math.round((row.ok/row.total)*100):0;
                    return (
                      <div key={row.hour} style={{
                        display:"flex",alignItems:"center",gap:12,
                        padding:"9px 12px",borderRadius:9,
                        background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                      }}>
                        <p style={{fontSize:12,fontWeight:700,color:C.txt("pri"),
                          fontFamily:"'DM Mono',monospace",flexShrink:0,minWidth:48}}>
                          {row.hour}
                        </p>
                        {/* Mini bar */}
                        <div style={{flex:1,height:6,borderRadius:99,
                          background:C.bdr(0.2),overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:99,
                            background:C.ok(),width:`${okPct}%`,transition:"width .4s"}}/>
                        </div>
                        <div style={{display:"flex",gap:8,flexShrink:0}}>
                          <span style={{fontSize:11,fontWeight:700,color:C.ok(),
                            padding:"2px 7px",borderRadius:5,
                            background:C.ok(0.1),border:`1px solid ${C.ok(0.25)}`}}>
                            ✓ {row.ok}
                          </span>
                          <span style={{fontSize:11,fontWeight:700,color:C.ng(),
                            padding:"2px 7px",borderRadius:5,
                            background:C.ng(0.1),border:`1px solid ${C.ng(0.25)}`}}>
                            ✗ {row.ng}
                          </span>
                          <span style={{fontSize:11,color:C.txt("muted")}}>
                            / {row.total}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Recent events */}
            <Card title="Recent Scan Events" icon={Wrench} accent={C.navy()}>
              {(stationStats?.recentParts||[]).length===0 ? (
                <p style={{fontSize:12,color:C.txt("muted")}}>No recent station events.</p>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:7,
                  maxHeight:320,overflowY:"auto"}}>
                  {(stationStats?.recentParts||[]).map((row,i)=>{
                    const res=String(row.result||"").toUpperCase();
                    const variant=res==="OK"?"ok":res==="NG"?"ng":"idle";
                    return (
                      <div key={row.id||i} style={{
                        padding:"10px 13px",borderRadius:9,
                        background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                        borderLeft:`3px solid ${STATUS_MAP[variant]?.fg||C.bdr()}`,
                      }}>
                        <div style={{display:"flex",alignItems:"center",
                          justifyContent:"space-between",gap:8,marginBottom:4}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,
                            fontWeight:700,color:C.txt("pri"),
                            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {row.partId||"—"}
                          </span>
                          <Badge variant={variant} label={variant==="ok"?"Pass":variant==="ng"?"Fail":"—"}/>
                        </div>
                        <div style={{display:"flex",alignItems:"center",
                          gap:12,fontSize:10,color:C.txt("muted")}}>
                          <span>{row.plcStatus||"—"}</span>
                          <span>{fmtTime(row.createdAt)}</span>
                        </div>
                        {row.interlockReason&&(
                          <p style={{fontSize:10,color:C.ng(),marginTop:4,lineHeight:1.4}}>
                            ⚠ {row.interlockReason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* ── Row 3: Live QR Feed ────────────────────────────────── */}
          {qrFeed.length>0&&(
            <Card title="Live QR Feed" icon={Radio} accent={C.steel()}>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {qrFeed.map(entry=>(
                  <div key={entry.id} style={{
                    display:"flex",alignItems:"center",gap:12,
                    padding:"9px 13px",borderRadius:9,
                    background:STATUS_MAP[entry.variant]?.bg||C.bg("surf"),
                    border:`1px solid ${STATUS_MAP[entry.variant]?.bd||C.bdr()}`,
                  }}>
                    <Badge variant={entry.variant} label={entry.label} pulse={entry.variant==="wip"}/>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,
                      fontWeight:700,color:C.txt("pri"),flex:1,
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {entry.partId||"—"}
                    </span>
                    {entry.stationNo&&(
                      <span style={{fontSize:10,color:C.txt("muted"),flexShrink:0}}>
                        {entry.stationNo}
                      </span>
                    )}
                    <span style={{fontSize:10,color:C.txt("muted"),
                      fontFamily:"'DM Mono',monospace",flexShrink:0}}>
                      {fmtTime(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Row 4: Bottom action bar ────────────────────────────── */}
          <div style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",
            flexWrap:"wrap",gap:12,
            padding:"12px 16px",borderRadius:12,
            background:C.bg("card"),border:`1px solid ${C.bdr()}`,
            boxShadow:SH,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
              <button style={{display:"inline-flex",alignItems:"center",gap:6,
                fontSize:12,fontWeight:600,color:C.txt("sec"),
                background:"none",border:"none",cursor:"pointer"}}>
                <CheckCircle2 size={14} color={C.ok()}/> Change Job
              </button>
              <button style={{display:"inline-flex",alignItems:"center",gap:6,
                fontSize:12,fontWeight:600,color:C.txt("sec"),
                background:"none",border:"none",cursor:"pointer"}}>
                <AlertTriangle size={14} color={C.ng()}/> Reject Part
              </button>
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {[
                {label:"Availability", value:`${Math.max(0,100-(qualitySummary.interlockedCount||0))}%`},
                {label:"Quality",      value:`${qualityPct}%`},
                {label:"In Progress",  value:qualitySummary.inProgressCount||0},
              ].map((s,i)=>(
                <div key={i} style={{
                  padding:"5px 14px",borderRadius:8,
                  background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                  fontSize:11,color:C.txt("pri"),
                  display:"flex",alignItems:"center",gap:6,
                }}>
                  <span style={{color:C.txt("muted")}}>{s.label}:</span>
                  <span style={{fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={Boolean(resetConfirm)}
        title="Confirm Reset Operation"
        message={`Reset operation for part "${resetConfirm?.partId || ""}" at station "${resetConfirm?.stationNo || ""}"?`}
        confirmText="Confirm Reset"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmResetOperation}
        onCancel={() => setResetConfirm(null)}
      />
    </div>
  );
};

export default OperatorView;

