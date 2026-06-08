// ============================================================
//  Dashboard.jsx — IndusTrace Premium Redesign
//  Color Theme: Navy / Steel / Amber / Linen
//  Clean professional language — no jargon
//  Supports: Dark + Light via [data-theme] on <html>
// ============================================================
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL } from "../constants/network";
import {
  RefreshCw, Filter, CheckCircle2, XCircle,
  AlertTriangle, Cpu, Activity, History, Clock,
  BellRing, X, Shield, Zap, Target, Layers,
  TrendingUp, BarChart3, Settings2, ChevronDown,
  Circle, Wifi, WifiOff,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, Legend, AreaChart, Area,
} from "recharts";
import { dashboardApi, machineApi } from "../api/services";
import ChartTooltip from "../components/charts/ChartTooltip";
import SafeChart from "../components/charts/SafeChart";
import { CHART_COLORS } from "../constants/chartTheme";
import { useLanguage } from "../context/LanguageContext";


// —— Design tokens —————————————————————————————————————————————————————————————
const DS = `
  @keyframes dbSpin    { to { transform:rotate(360deg) } }
  @keyframes dbFadeIn  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes dbPulse   { 0%,100%{opacity:1} 50%{opacity:.45} }
  @keyframes dbPing    { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.2);opacity:0} }
  :root{
    --db-navy:  26,50,99;
    --db-steel: 84,119,146;
    --db-amber: 250,185,91;
    --db-linen: 232,226,219;
    --db-ok:    34,197,94;
    --db-ng:    239,68,68;
    --db-wip:   249,115,22;
    --db-idle:  148,163,184;
    --font-db:  "Inter", "Sora", "Outfit", system-ui, sans-serif;
  }
  .db-font { font-family: var(--font-db); }
  [data-theme="light"]{
    --db-bg-base:    248,246,243;
    --db-bg-card:    255,255,255;
    --db-bg-surf:    240,236,230;
    --db-bg-input:   255,255,255;
    --db-txt-pri:    26,50,99;
    --db-txt-sec:    84,119,146;
    --db-txt-muted:  140,160,180;
    --db-bdr:        84,119,146;
    --db-bop:        0.14;
  }
  [data-theme="dark"]{
    --db-bg-base:    10,18,36;
    --db-bg-card:    20,34,62;
    --db-bg-surf:    16,26,50;
    --db-bg-input:   14,22,44;
    --db-txt-pri:    232,226,219;
    --db-txt-sec:    120,160,190;
    --db-txt-muted:  84,119,146;
    --db-bdr:        84,119,146;
    --db-bop:        0.18;
  }
  @media (max-width: 1200px){
    .db-tablet-grid-2 { grid-template-columns: 1fr !important; }
    .db-tablet-cards { grid-template-columns: repeat(auto-fill,minmax(300px,1fr)) !important; }
    .db-tablet-oeeoa { grid-template-columns: repeat(auto-fill,minmax(320px,1fr)) !important; }
    .db-tablet-pad { padding: 16px !important; }
    .db-tablet-chart-compact { height: 190px !important; }
  }
  @media (max-width: 900px){
    .db-tablet-cards { grid-template-columns: 1fr !important; }
    .db-tablet-oeeoa { grid-template-columns: 1fr !important; }
  }
`;

let _dsInjected = false;
function injectDS() {
  if (_dsInjected || typeof document==="undefined") return;
  _dsInjected = true;
  const el = document.createElement("style");
  el.textContent = DS;
  document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme","dark");
}

// —— Color helpers —————————————————————————————————————————————————————————————
const C = {
  navy:   (o=1) => `rgba(var(--db-navy),${o})`,
  steel:  (o=1) => `rgba(var(--db-steel),${o})`,
  amber:  (o=1) => `rgba(var(--db-amber),${o})`,
  linen:  (o=1) => `rgba(var(--db-linen),${o})`,
  ok:     (o=1) => `rgba(var(--db-ok),${o})`,
  ng:     (o=1) => `rgba(var(--db-ng),${o})`,
  wip:    (o=1) => `rgba(var(--db-wip),${o})`,
  idle:   (o=1) => `rgba(var(--db-idle),${o})`,
  bg:     (v="card") => `rgb(var(--db-bg-${v}))`,
  txt:    (v="pri")  => `rgb(var(--db-txt-${v}))`,
  bdr:    (o)        => `rgba(var(--db-bdr),${o||"var(--db-bop)"})`,
};

const SHADOW = `0 2px 12px rgba(var(--db-navy),.08),0 1px 3px rgba(var(--db-navy),.05)`;
const SHADOW_MD = `0 4px 20px rgba(var(--db-navy),.12),0 2px 6px rgba(var(--db-navy),.06)`;

function normalizeRejectionType(reason = "") {
  const r = String(reason || "")
    .trim()
    .toUpperCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!r) return "MR - MR Defects";

  // MR: scan/traceability/data flow or generic manual reject paths.
  if (
    r.includes("DUPLICATE") ||
    r.includes("FORMAT") ||
    r.includes("QR") ||
    r.includes("SCAN") ||
    r.includes("ALREADY COMPLETED") ||
    r.includes("VALIDATION") ||
    r.includes("MANUAL REJECT")
  ) {
    return "MR - MR Defects";
  }

  // CRAM: dimensional/geometry/chamfer/profile/surface-measurement style defects.
  if (
    r.includes("CRAM") ||
    r.includes("CHAMFER") ||
    r.includes("ROUGHNESS") ||
    r.includes("PROFILE") ||
    r.includes("POSITION") ||
    r.includes("DIMENSION") ||
    r.includes("DIA") ||
    r.includes("DIAMETER") ||
    r.includes("HEIGHT") ||
    r.includes("WIDTH") ||
    r.includes("LENGTH") ||
    r.includes("RUNOUT") ||
    r.includes("CONCENTRICITY")
  ) {
    return "CRAM - Cram Defects";
  }

  // CR: casting/process-body defects.
  if (
    r.includes(" CAST") ||
    r.startsWith("CAST") ||
    r.includes("POROSITY") ||
    r.includes("BLOW HOLE") ||
    r.includes("LEAK") ||
    r.includes("SHRINKAGE") ||
    r.includes("CRACK") ||
    r.includes("FLASH") ||
    r.includes("BURR") ||
    r.includes("COLD SHUT") ||
    r.includes("PIN HOLE") ||
    r.includes("SAND")
  ) {
    return "CR - Casting Defects";
  }

  // Keep plain "CR" token check at the end to avoid false positives in other words.
  if (/(^|\s)CR(\s|$)/.test(r)) return "CR - Casting Defects";
  return "MR - MR Defects";
}

function localDateTimeToIso(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function uniqueStages(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const token = String(row || "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

const EMPTY_SUMMARY = {
  machines:{ total:0, active:0, inactive:0 },
  parts:{ inProgress:0, completed:0, ng:0, interlocked:0, rework:0 },
  quality:{ ok:0, ng:0 },
  recentScans:[], availableShifts:[],
};
const EMPTY_REPORT = {
  machineWise:[], machineCards:[], stationCards:[], hourlyProduction:[],
  shiftProduction:{ SHIFT_A:{total:0,ok:0,ng:0}, SHIFT_B:{total:0,ok:0,ng:0}, SHIFT_C:{total:0,ok:0,ng:0} },
  interlockHistory:[], reworkCount:0, partJourney:[],
};

// —— OEE Radial Gauge ——————————————————————————————————————————————————————————
const OeeGauge = ({ value=0, size=88, stroke=9 }) => {
  const pct   = Math.min(100, Math.max(0, value));
  const r     = (size-stroke)/2;
  const circ  = 2*Math.PI*r;
  const color = pct>=85 ? C.ok() : pct>=60 ? C.amber() : C.ng();
  return (
    <div style={{position:"relative",width:size,height:size}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.bdr(0.25)} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={circ-(pct/100)*circ}
          strokeLinecap="round"
          style={{transition:"stroke-dashoffset 1s ease",filter:`drop-shadow(0 0 6px ${color}88)`}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontSize:size>70?14:11,fontWeight:800,color,
          fontFamily:"'DM Mono',monospace"}}>{pct}%</span>
      </div>
    </div>
  );
};

// —— Status Badge ——————————————————————————————————————————————————————————————
const Badge = ({ variant="idle", label }) => {
  const map = {
    ok:   { fg:C.ok(),   bg:C.ok(0.1),   bdr:C.ok(0.25)   },
    ng:   { fg:C.ng(),   bg:C.ng(0.1),   bdr:C.ng(0.25)   },
    wip:  { fg:C.wip(),  bg:C.wip(0.1),  bdr:C.wip(0.25)  },
    idle: { fg:C.idle(), bg:C.idle(0.08),bdr:C.idle(0.2)  },
  };
  const s = map[variant]||map.idle;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 10px",
      borderRadius:99,fontSize:11,fontWeight:700,letterSpacing:"0.04em",
      color:s.fg,background:s.bg,border:`1px solid ${s.bdr}`,whiteSpace:"nowrap"}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:s.fg,flexShrink:0}}/>
      {label}
    </span>
  );
};

// —— KPI Card ——————————————————————————————————————————————————————————————————
const KpiCard = ({ label, value, icon:Icon, accent, sub }) => (
  <div style={{
    background:C.bg("card"),border:`1px solid ${C.bdr()}`,
    borderRadius:14,padding:"16px 18px",
    boxShadow:SHADOW,
    borderLeft:`3px solid ${accent||C.steel()}`,
    display:"flex",flexDirection:"column",gap:8,
  }}>
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
      <p style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
        letterSpacing:"0.07em",color:C.txt("muted"),lineHeight:1.3}}>{label}</p>
      <div style={{width:26,height:26,borderRadius:8,
        background:`rgba(${accent?accent.replace(/rgba\(|,\d+\)|\)$/g,"").replace(/rgb\(|,\d+,\d+\)$/g,""):"var(--db-steel)"},0.1)`,
        display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <Icon size={13} color={accent||C.steel()}/>
      </div>
    </div>
    <p style={{fontSize:28,fontWeight:800,color:C.txt("pri"),lineHeight:1,
      fontFamily:"'DM Mono',monospace",fontVariantNumeric:"tabular-nums"}}>{value}</p>
    {sub && <p style={{fontSize:11,color:C.txt("muted")}}>{sub}</p>}
  </div>
);

// —— Machine KPI Card ——————————————————————————————————————————————————————————
const MachineCard = ({ row, plcOnline=null, scannerOnline=null, nowMs=0 }) => {
  const acc   = Number(row.accuracy||0);
  const color = acc>=85 ? C.ok() : acc>=60 ? C.amber() : C.ng();
  const lastScan = row.lastScanTime ? new Date(row.lastScanTime) : null;
  const msAgo    = lastScan&&nowMs ? nowMs-lastScan.getTime() : null;
  const scanColor = msAgo===null ? C.txt("muted")
    : msAgo>600000 ? C.ng() : msAgo>300000 ? C.amber() : C.ok();

  return (
    <div style={{
      background:C.bg("card"),border:`1px solid ${C.bdr()}`,
      borderRadius:14,padding:"18px 18px 14px",
      boxShadow:SHADOW,position:"relative",overflow:"hidden",
      transition:"border-color 0.15s, box-shadow 0.15s",
    }}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.steel(0.5);e.currentTarget.style.boxShadow=SHADOW_MD;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.bdr();e.currentTarget.style.boxShadow=SHADOW;}}
    >
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
        <OeeGauge value={acc} size={56} stroke={6}/>
        <div style={{minWidth:0,flex:1}}>
          <p style={{fontSize:14,fontWeight:800,color:C.txt("pri"),
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:3}}>
            {row.machineName||"Machine"}
          </p>
          <p style={{fontSize:11,color:C.txt("muted"),overflow:"hidden",
            textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {row.lineName||"—"} · {row.stationNo||"—"}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
        {[
          { label:"Produced",  value:row.processedCount,       color:C.txt("pri")  },
          { label:"Target",    value:(row.targetProduction ?? row.targetQty ?? 0), color:C.txt("muted")},
          { label:"Achieved",  value:`${row.achievementPct||0}%`, color:color       },
        ].map((s,i)=>(
          <div key={i} style={{background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
            borderRadius:9,padding:"8px 6px",textAlign:"center"}}>
            <p style={{fontSize:16,fontWeight:800,color:s.color,
              fontFamily:"'DM Mono',monospace",lineHeight:1}}>{s.value}</p>
            <p style={{fontSize:10,fontWeight:700,color:C.txt("muted"),
              textTransform:"uppercase",letterSpacing:"0.06em",marginTop:4}}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        paddingTop:10,borderTop:`1px solid ${C.bdr()}`,flexWrap:"wrap",gap:6}}>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <Clock size={10} color={C.txt("muted")}/>
          <span style={{fontSize:11,color:scanColor,fontFamily:"'DM Mono',monospace"}}>
            {lastScan ? lastScan.toLocaleTimeString() : "—"}
          </span>
        </div>
        <div style={{display:"flex",gap:12}}>
          <span title={plcOnline === null ? "PLC status unknown / not assigned" : (plcOnline ? "PLC online" : "PLC offline")} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,color:plcOnline===null?C.txt("muted"):(plcOnline?C.ok():C.ng())}}>
            {plcOnline ? <Wifi size={11} color={C.ok()}/> : <WifiOff size={11} color={plcOnline===null?C.steel():C.ng()}/>}
            PLC
          </span>
          <span title={scannerOnline === null ? "Scanner status unknown / not assigned" : (scannerOnline ? "Scanner online" : "Scanner offline")} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,color:scannerOnline===null?C.txt("muted"):(scannerOnline?C.ok():C.ng())}}>
            {scannerOnline ? <Wifi size={11} color={C.ok()}/> : <WifiOff size={11} color={scannerOnline===null?C.steel():C.ng()}/>}
            SCN
          </span>
          <span title="Duration-based downtime from production log gaps" style={{fontSize:11,fontWeight:700,color:C.steel()}}>
            DT Min {Math.round(Number(row.downtimeMinutes || 0))}
          </span>
          <span style={{fontSize:11,fontWeight:700,color:C.ng(0.85)}}>
            RW {row.reworkCount||0}
          </span>
        </div>
      </div>
    </div>
  );
};

// —— Section header ————————————————————————————————————————————————————————————
const SectionHead = ({ title, right }) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
    marginBottom:16,flexWrap:"wrap",gap:8}}>
    <p style={{fontSize:11,fontWeight:800,textTransform:"uppercase",
      letterSpacing:"0.09em",color:C.txt("muted")}}>{title}</p>
    {right}
  </div>
);

const ChartModeToggle = ({ mode, onChange }) => {
  const btn = (id, Icon) => (
    <button
      key={id}
      onClick={() => onChange(id)}
      style={{
        width: 26, height: 26, borderRadius: 7, border: `1px solid ${C.bdr()}`,
        background: mode === id ? C.navy(0.12) : "transparent",
        color: mode === id ? C.navy() : C.txt("muted"),
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
      }}
      title={`${id} view`}
    >
      <Icon size={13} />
    </button>
  );
  return <div style={{ display: "inline-flex", gap: 6 }}>{btn("bar", BarChart3)}{btn("line", Activity)}{btn("area", Layers)}</div>;
};

// —— Chart tooltip theme ———————————————————————————————————————————————————————
const TooltipStyle = {
  contentStyle:{
    background:C.bg("card"),border:`1px solid ${C.bdr()}`,
    borderRadius:10,fontSize:12,color:C.txt("pri"),
    boxShadow:SHADOW_MD,
    maxWidth: 220,
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
  labelStyle:{ color:C.txt("sec"), fontWeight:700 },
  itemStyle:{ color:C.txt("pri") },
  wrapperStyle:{ zIndex: 9999, pointerEvents: "none" },
  allowEscapeViewBox:{ x: true, y: true },
};

const getPresetRange = (preset) => {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  if (preset === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (preset === "last7") {
    start.setDate(start.getDate() - 7);
  } else if (preset === "last30") {
    start.setMonth(start.getMonth() - 1);
  } else {
    return { start: "", end: "" };
  }
  return { start: start.toISOString(), end: end.toISOString() };
};

// ==============================================================================
//  DASHBOARD
// ==============================================================================
const Dashboard = () => {
  injectDS();
  const { t } = useLanguage();

  const [machines,     setMachines]     = useState([]);
  const [summary,      setSummary]      = useState(EMPTY_SUMMARY);
  const [report,       setReport]       = useState(EMPTY_REPORT);
  const [oeeData,      setOeeData]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState("overview");
  const [showFilters,  setShowFilters]  = useState(false);
  const [plcMap,       setPlcMap]       = useState({});
  const [nowMs,        setNowMs]        = useState(Date.now());
  const [filters,      setFilters]      = useState({
    dateFrom:"", dateTo:"", datePreset:"", machineId:"", lineName:"", partId:"", status:"", shiftCode:"",
  });
  const [chartModeHourly, setChartModeHourly] = useState("line");
  const [chartModeShift, setChartModeShift] = useState("bar");
  const [chartModeRejectTrend, setChartModeRejectTrend] = useState("area");
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const lastRefreshAtRef = useRef(0);

  const query = useMemo(() => {
    const presetRange = getPresetRange(filters.datePreset);
    const dateFrom = presetRange.start || localDateTimeToIso(filters.dateFrom);
    const dateTo = presetRange.end || localDateTimeToIso(filters.dateTo);
    return {
    dateFrom,
    dateTo,
    machineId:  filters.machineId  || undefined,
    lineName:   filters.lineName   || undefined,
    partId:     filters.partId     || undefined,
    status:     filters.status     || undefined,
    shiftCode:  filters.shiftCode  || undefined,
  };
  },[filters]);

  const loadData = useCallback(async()=>{
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    try {
      setLoading(true);
      const [m,s,r,o] = await Promise.all([
        machineApi.list(),
        dashboardApi.summary(query),
        dashboardApi.report(query),
        dashboardApi.oee().catch(()=>null),
      ]);
      setMachines(m||[]);
      setSummary(s||EMPTY_SUMMARY);
      setReport(r||EMPTY_REPORT);
      if (o) setOeeData(o?.oee||[]);
    } catch(e){
      console.error("Dashboard load error",e);
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        loadData();
      }
    }
  },[query]);

  const scheduleRefresh = useCallback((cooldownMs = 300) => {
    const elapsed = Date.now() - lastRefreshAtRef.current;
    const delay = Math.max(0, cooldownMs - elapsed);
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      lastRefreshAtRef.current = Date.now();
      loadData();
    }, delay);
  }, [loadData]);

  useEffect(()=>{
    scheduleRefresh(0);
    const t=setInterval(()=>scheduleRefresh(200),15000);
    return()=>{
      clearInterval(t);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  },[scheduleRefresh]);
  useEffect(()=>{ const t=setInterval(()=>setNowMs(Date.now()),30000); return()=>clearInterval(t); },[]);

  useEffect(()=>{
    const sock=io(SOCKET_URL,{
      path:"/socket.io/",
      transports: ["polling"], upgrade: false,
      reconnection:true,
      reconnectionAttempts:Infinity,
      reconnectionDelay:1000,
      reconnectionDelayMax:5000,
      timeout:10000,
    });
    sock.on("dashboard_refresh",()=>scheduleRefresh(350));
    sock.on("plc_connection_event",d=>{
      if (d.machineId) setPlcMap(p=>({...p,[d.machineId]:d.state==="COMPLETED"||d.state==="CLOSED"}));
    });
    return()=>sock.close();
  },[scheduleRefresh]);

  const efficiency = useMemo(()=>{
    const ok = Number(summary.quality?.ok || 0);
    const ng = Number(summary.quality?.ng || 0);
    const t = ok + ng;
    return t > 0 ? Math.round((ok / t) * 100) : 0;
  },[summary.quality]);
  const lineContextLabel = useMemo(() => {
    const selectedMachineId = Number(filters.machineId || 0);
    if (selectedMachineId) {
      const machine = machines.find((row) => Number(row.id) === selectedMachineId);
      return machine?.lineName ? `Line: ${machine.lineName}` : "Line: -";
    }
    if (filters.lineName) {
      return `Line: ${filters.lineName}`;
    }
    const lines = [...new Set((machines || []).map((row) => String(row.lineName || "").trim()).filter(Boolean))];
    if (lines.length === 0) return "Line: All";
    if (lines.length === 1) return `Line: ${lines[0]}`;
    return `Line: All (${lines.length})`;
  }, [filters.machineId, filters.lineName, machines]);

  // Pie data
  const pieData = useMemo(()=>[
    { name:"Pass",    value:Number(summary.quality?.ok || 0)               },
    { name:"Fail",    value:Number(summary.quality?.ng || 0)               },
    { name:"Blocked", value:Number(summary.parts?.interlocked || summary.quality?.interlocked || 0) },
  ],[summary.parts, summary.quality]);

  // Shift bar data
  const shiftData = useMemo(() => {
    const grouped = Array.isArray(report.shiftWiseMetrics) ? report.shiftWiseMetrics : [];
    const shiftOrder = ["SHIFT_A", "SHIFT_B", "SHIFT_C"];
    const shiftLabel = {
      SHIFT_A: "Shift A",
      SHIFT_B: "Shift B",
      SHIFT_C: "Shift C",
    };
    if (grouped.length > 0) {
      const normalizedMap = grouped.reduce((acc, row) => {
        const code = String(row.shiftCode || "UNASSIGNED").toUpperCase();
        if (!acc[code]) {
          acc[code] = { code, actual: 0, target: 0, oee: 0, oa: 0, count: 0 };
        }
        acc[code].actual += Number(row.actualProduction || 0);
        acc[code].target += Number(row.targetProduction || 0);
        acc[code].oee += Number(row.oee || 0);
        acc[code].oa += Number(row.oa || 0);
        acc[code].count += 1;
        return acc;
      }, {});
      return shiftOrder.map((code) => ({
        code,
        name: shiftLabel[code],
        actual: Number(normalizedMap[code]?.actual || 0),
        target: Number(normalizedMap[code]?.target || 0),
        oee: Number((normalizedMap[code]?.oee || 0) / Math.max(1, normalizedMap[code]?.count || 0)),
        oa: Number((normalizedMap[code]?.oa || 0) / Math.max(1, normalizedMap[code]?.count || 0)),
      }));
    }
    const fallbackMap = Object.entries(report.shiftProduction || {}).reduce((acc, [k, v]) => {
      acc[String(k).toUpperCase()] = {
        actual: Number((v?.ok || 0) + (v?.ng || 0)),
      };
      return acc;
    }, {});
    return shiftOrder.map((code) => ({
      code,
      name: shiftLabel[code],
      actual: Number(fallbackMap[code]?.actual || 0),
      target: 0,
      oee: 0,
      oa: 0,
    }));
  }, [report.shiftProduction, report.shiftWiseMetrics]);

  const hasFilters = Object.values(filters).some(Boolean);
  const selectedFilterCount = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);
  
  const rejectionAnalysisRows = useMemo(() => {
    const historyRows = Array.isArray(report.interlockHistory) ? report.interlockHistory : [];
    if (historyRows.length > 0) {
      return historyRows.map((row) => ({
        partId: row.partId || row.part_id || "-",
        reason: row.reason || row.interlock_reason || row.message || "Unknown reason",
        result: "NG",
        createdAt: row.createdAt || row.timestamp || null,
      }));
    }
    const fallbackRows = Array.isArray(report.partsList) ? report.partsList : [];
    return fallbackRows
      .filter((row) => String(row.result || "").toUpperCase() === "NG")
      .map((row) => ({
        partId: row.partId || row.part_id || "-",
        reason: row.reason || row.interlock_reason || row.message || "Unknown reason",
        result: "NG",
        createdAt: row.createdAt || row.timestamp || null,
      }));
  }, [report.interlockHistory, report.partsList]);

  const rejectionPieData = useMemo(() => {
    const grouped = rejectionAnalysisRows.reduce((acc, row) => {
      const k = normalizeRejectionType(row.reason || row.interlock_reason || "");
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    return [
      { name: "CR - Casting Defects", value: grouped["CR - Casting Defects"] || 0, color: C.ng() },
      { name: "CRAM - Cram Defects", value: grouped["CRAM - Cram Defects"] || 0, color: C.amber() },
      { name: "MR - MR Defects", value: grouped["MR - MR Defects"] || 0, color: C.steel() },
    ];
  }, [rejectionAnalysisRows]);

  const rejectionTopReasons = useMemo(() => {
    const grouped = rejectionAnalysisRows.reduce((acc, row) => {
      const reason = String(row.reason || row.interlock_reason || "Unknown reason").trim() || "Unknown reason";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [rejectionAnalysisRows]);

  const rejectionTrend = useMemo(() => {
    const rows = rejectionAnalysisRows
      .map((row) => {
        const ts = new Date(row.timestamp || row.createdAt || Date.now());
        const slot = `${String(ts.getHours()).padStart(2, "0")}:00`;
        return { slot, category: normalizeRejectionType(row.reason || row.interlock_reason || "") };
      });
    const bucket = rows.reduce((acc, row) => {
      if (!acc[row.slot]) acc[row.slot] = { slot: row.slot, total: 0, cr: 0, cram: 0, mr: 0 };
      acc[row.slot].total += 1;
      if (row.category === "CR - Casting Defects") acc[row.slot].cr += 1;
      else if (row.category === "CRAM - Cram Defects") acc[row.slot].cram += 1;
      else acc[row.slot].mr += 1;
      return acc;
    }, {});
    return Object.values(bucket).sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
  }, [rejectionAnalysisRows]);

  const isMultiDayRange = useMemo(() => {
    if (filters.datePreset === "last7" || filters.datePreset === "last30") return true;
    if (filters.dateFrom && filters.dateTo) {
      const fromMs = new Date(filters.dateFrom).getTime();
      const toMs = new Date(filters.dateTo).getTime();
      if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
        return (toMs - fromMs) > 36 * 60 * 60 * 1000;
      }
    }
    return false;
  }, [filters.datePreset, filters.dateFrom, filters.dateTo]);

  const productionTrendData = useMemo(() => {
    if (!isMultiDayRange) return report.hourlyProduction || [];
    const rows = Array.isArray(report.partsList) ? report.partsList : [];
    const bucket = rows.reduce((acc, row) => {
      const ts = new Date(row.createdAt || row.createdAtRaw || Date.now());
      if (Number.isNaN(ts.getTime())) return acc;
      const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
      if (!acc[key]) acc[key] = { date: key, ok: 0, ng: 0, total: 0 };
      const result = String(row.result || row.status || "").toUpperCase();
      if (result === "OK" || result === "PASSED") acc[key].ok += 1;
      else if (result === "NG" || result === "FAILED") acc[key].ng += 1;
      acc[key].total += 1;
      return acc;
    }, {});
    return Object.values(bucket).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [isMultiDayRange, report.hourlyProduction, report.partsList]);

  const rejectionTrendData = useMemo(() => {
    if (!isMultiDayRange) return rejectionTrend;
    const rows = rejectionAnalysisRows.map((row) => {
      const ts = new Date(row.createdAt || Date.now());
      const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
      return { key, category: normalizeRejectionType(row.reason || row.interlock_reason || "") };
    });
    const bucket = rows.reduce((acc, row) => {
      if (!acc[row.key]) acc[row.key] = { date: row.key, total: 0, cr: 0, cram: 0, mr: 0 };
      acc[row.key].total += 1;
      if (row.category === "CR - Casting Defects") acc[row.key].cr += 1;
      else if (row.category === "CRAM - Cram Defects") acc[row.key].cram += 1;
      else acc[row.key].mr += 1;
      return acc;
    }, {});
    return Object.values(bucket).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [isMultiDayRange, rejectionTrend, rejectionAnalysisRows]);

  const analysisMachineRows = useMemo(() => {
    const filteredCards = Array.isArray(report.machineCards) ? report.machineCards : [];
    if (filteredCards.length > 0) return filteredCards;
    return Array.isArray(oeeData) ? oeeData : [];
  }, [oeeData, report.machineCards]);

  // —— Tabs config ——
  const TABS = [
    { id:"overview",  label:"Overview",          icon:BarChart3  },
    { id:"machines",  label:"Machine KPIs",      icon:Cpu        },
    { id:"oee",       label:"OEE Analysis",      icon:Activity   },
    { id:"oa",        label:"OA Analysis",       icon:Target     },
    { id:"rejection", label:"Rejection Analysis",icon:AlertTriangle },
      ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,paddingBottom:32,
      animation:"dbFadeIn 0.3s ease"}}>

      {/* —— Page Header ————————————————————————————————————————————————————————— */}
      <div style={{
        background:C.bg("card"),border:`1px solid ${C.bdr()}`,
        borderRadius:16,padding:"18px 20px",boxShadow:SHADOW,overflow:"hidden",
      }}>
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,
          margin:"-18px -20px 16px"}}/>

        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",
          flexWrap:"wrap",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:46,height:46,borderRadius:13,
              background:`linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
              display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
              boxShadow:`0 4px 14px ${C.navy(0.35)}`}}>
              <BarChart3 size={22} color={C.linen()}/>
            </div>
            <div>
              <h1 style={{fontSize:18,fontWeight:800,color:C.txt("pri"),
                letterSpacing:"-0.02em",lineHeight:1.2, fontFamily:"var(--font-outfit)"}}>
                Dashboard Overview
              </h1>
              <p style={{
                marginTop:6,
                display:"inline-flex",
                alignItems:"center",
                padding:"3px 10px",
                borderRadius:999,
                fontSize:11,
                fontWeight:800,
                color:C.navy(),
                background:C.navy(0.08),
                border:`1px solid ${C.navy(0.2)}`,
                letterSpacing:"0.03em"
              }}>
                {lineContextLabel}
              </p>
              
            </div>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <button onClick={()=>setShowFilters(f=>!f)}
              style={{
                display:"inline-flex",alignItems:"center",gap:7,
                height:38,padding:"0 16px",borderRadius:9,
                fontSize:12,fontWeight:700,cursor:"pointer",
                background:hasFilters?C.navy(0.08):"transparent",
                border:`1px solid ${hasFilters?C.navy(0.4):C.bdr()}`,
                color:hasFilters?C.navy():C.txt("sec"),
                transition:"all 0.15s",
              }}>
              <Filter size={13}/> Filters
              {hasFilters && (
                <span style={{width:16,height:16,borderRadius:"50%",
                  background:C.amber(),color:C.navy(),
                  fontSize:9,fontWeight:800,display:"flex",
                  alignItems:"center",justifyContent:"center"}}>
                  {Object.values(filters).filter(Boolean).length}
                </span>
              )}
            </button>

            <button onClick={loadData} disabled={loading}
              style={{
                display:"inline-flex",alignItems:"center",gap:7,
                height:38,padding:"0 14px",borderRadius:9,
                fontSize:12,fontWeight:700,cursor:"pointer",
                background:"transparent",border:`1px solid ${C.bdr()}`,
                color:C.txt("sec"),transition:"all 0.15s",
                opacity:loading?0.6:1,
              }}>
              <RefreshCw size={13} style={{animation:loading?"dbSpin 0.9s linear infinite":"none"}}/>
              {loading?"Updating…":"Refresh"}
            </button>

          </div>
        </div>

        {showFilters && (
          <div style={{
            marginTop:16,padding:"16px",borderRadius:12,
            background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
            display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12,
            animation:"dbFadeIn 0.2s ease",
          }}>
            <div style={{display:"flex", flexDirection:"column", gap:5}}>
              <label style={{fontSize:10, fontWeight:800, color:C.txt("muted"), textTransform:"uppercase"}}>From Date/Time</label>
              <input
                type="datetime-local"
                value={filters.dateFrom}
                onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value, datePreset: "" }))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"var(--font-db)",
                }}
              />
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:5}}>
              <label style={{fontSize:10, fontWeight:800, color:C.txt("muted"), textTransform:"uppercase"}}>To Date/Time</label>
              <input
                type="datetime-local"
                value={filters.dateTo}
                onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value, datePreset: "" }))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"var(--font-db)",
                }}
              />
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:5}}>
              <label style={{fontSize:10, fontWeight:800, color:C.txt("muted"), textTransform:"uppercase"}}>Date Range</label>
              <select
                value={filters.datePreset}
                onChange={e=>setFilters(prev=>({...prev,datePreset:e.target.value, dateFrom:"", dateTo:""}))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"var(--font-db)",
                  cursor:"pointer",
                  appearance:"auto",
                }}>
               
                <option value="today">Today</option>
                <option value="last7">Last 7 Days</option>
                <option value="last30">Last 1 Month</option>
              </select>
            </div>

            <div style={{display:"flex", flexDirection:"column", gap:5}}>
              <label style={{fontSize:10, fontWeight:800, color:C.txt("muted"), textTransform:"uppercase"}}>Production Line</label>
              <select
                value={filters.lineName}
                onChange={e=>setFilters(prev=>({...prev,lineName:e.target.value,machineId:""}))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"var(--font-db)",
                  cursor:"pointer",
                  appearance:"auto",
                }}>
                <option value="">All Lines</option>
                {uniqueStages((summary.availableLines || []).map((line) => String(line || "").trim()).filter(Boolean)).map((line)=>(
                  <option key={line} value={line}>{line}</option>
                ))}
              </select>
            </div>

            <div style={{display:"flex", flexDirection:"column", gap:5}}>
              <label style={{fontSize:10, fontWeight:800, color:C.txt("muted"), textTransform:"uppercase"}}>Machine Name</label>
              <select
                value={filters.machineId}
                onChange={e=>setFilters(prev=>({...prev,machineId:e.target.value}))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"var(--font-db)",
                  cursor:"pointer",
                  appearance:"auto",
                }}>
                <option value="">All Machines</option>
                {machines
                  .filter((m) => !filters.lineName || String(m.lineName || "").trim() === filters.lineName)
                  .map(m=>(
                  <option key={m.id} value={m.id}>{m.machineName}</option>
                ))}
              </select>
            </div>

            <div style={{display:"flex", flexDirection:"column", gap:5}}>
              <label style={{fontSize:10, fontWeight:800, color:C.txt("muted"), textTransform:"uppercase"}}>Part Serial No</label>
              <input
                type="text"
                placeholder="Search serial..."
                value={filters.partId}
                onChange={e=>setFilters(prev=>({...prev,partId:e.target.value}))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"var(--font-db)",
                }}
              />
            </div>

            <div style={{display:"flex", flexDirection:"column", gap:5}}>
              <label style={{fontSize:10, fontWeight:800, color:C.txt("muted"), textTransform:"uppercase"}}>Result Status</label>
              <select
                value={filters.status}
                onChange={e=>setFilters(prev=>({...prev,status:e.target.value}))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"var(--font-db)",
                  cursor:"pointer",
                  appearance:"auto",
                }}>
                <option value="">All Status</option>
                <option value="OK">Pass (OK)</option>
                <option value="NG">Fail (NG)</option>
                <option value="WIP">In Progress</option>
                <option value="INTERLOCKED">Interlocked</option>
              </select>
            </div>

            <div style={{display:"flex", flexDirection:"column", gap:5}}>
              <label style={{fontSize:10, fontWeight:800, color:C.txt("muted"), textTransform:"uppercase"}}>Shift</label>
              <select
                value={filters.shiftCode}
                onChange={e=>setFilters(prev=>({...prev,shiftCode:e.target.value}))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"var(--font-db)",
                  cursor:"pointer",
                  appearance:"auto",
                }}>
                <option value="">All Shifts</option>
                {(summary.availableShifts||["SHIFT_A","SHIFT_B","SHIFT_C"]).map(s=>(
                  <option key={typeof s === 'string' ? s : s.shiftCode} value={typeof s === 'string' ? s : s.shiftCode}>
                    {typeof s === 'string' ? s.replace("_"," ") : (s.shiftName || s.shiftCode)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* --- Filter Summary Bar --- */}
      {hasFilters && (
        <div style={{
          background: C.bg("surf"),
          border: `1px solid ${C.navy(0.2)}`,
          borderRadius: 12,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          animation: "dbFadeIn 0.3s ease",
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.05)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{
              background: C.navy(),
              color: "#fff",
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.05em"
            }}>
              Active Filters
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {filters.datePreset && <Badge variant="idle" label={`Range: ${filters.datePreset === "today" ? "Today" : filters.datePreset === "last7" ? "Last 7 Days" : "Last 1 Month"}`} />}
              {filters.dateFrom && !filters.datePreset && <Badge variant="idle" label={`From: ${new Date(filters.dateFrom).toLocaleString()}`} />}
              {filters.dateTo && !filters.datePreset && <Badge variant="idle" label={`To: ${new Date(filters.dateTo).toLocaleString()}`} />}
              {filters.lineName && <Badge variant="idle" label={`Line: ${filters.lineName}`} />}
              {filters.machineId && <Badge variant="idle" label={`Machine: ${machines.find(m => String(m.id) === String(filters.machineId))?.machineName || filters.machineId}`} />}
              {filters.partId && <Badge variant="idle" label={`Part: ${filters.partId}`} />}
              {filters.status && <Badge variant={filters.status === "OK" ? "ok" : filters.status === "NG" ? "ng" : "wip"} label={`Status: ${filters.status}`} />}
              {filters.shiftCode && <Badge variant="idle" label={`Shift: ${filters.shiftCode}`} />}
            </div>
          </div>
          <button 
            onClick={() => {
              setFilters({dateFrom:"",dateTo:"",datePreset:"",machineId:"",lineName:"",partId:"",status:"",shiftCode:""});
            }}
            style={{
              background: "transparent",
              border: "none",
              color: C.ng(),
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4
            }}
          >
            <X size={14} /> Clear All
          </button>
        </div>
      )}

      {/* —— KPI Row —————————————————————————————————————————————————————————————— */}
      <div style={{display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
        <KpiCard label="Total Quality Gates"  value={summary.machines.active}         icon={Cpu}          accent={C.steel()}  sub={`Out of ${summary.machines.total} total machines`}/>
        <KpiCard label="In Progress"      value={summary.parts.inProgress}         icon={Zap}          accent={C.wip()}    sub="Parts being processed"/>
        <KpiCard label="Completed (Pass)" value={summary.quality?.ok || 0}         icon={CheckCircle2} accent={C.ok()}     sub="Total OK this period"/>
        <KpiCard label="Failed (NG)"      value={summary.quality?.ng || 0}         icon={XCircle}      accent={C.ng()}     sub="Requires attention"/>
        <KpiCard label="Interlocked"      value={summary.parts.interlocked||0}     icon={AlertTriangle}accent={C.amber()}  sub="PLC blocked"/>
        <KpiCard label="Quality Rate"        value={`${efficiency}%`}                 icon={TrendingUp}   accent={efficiency>=85?C.ok():efficiency>=60?C.amber():C.ng()} sub="Overall quality rate"/>
      </div>

      {/* —— Tabs ————————————————————————————————————————————————————————————————————— */}
      <div style={{display:"flex",gap:6,padding:"6px",
        background:C.bg("card"),border:`1px solid ${C.bdr()}`,
        borderRadius:12,width:"fit-content",
        overflowX:"auto",maxWidth:"100%"}}>
        {TABS.map(tab=>{
          const active = activeTab===tab.id;
          const TIcon  = tab.icon;
          return (
            <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
              style={{
                display:"inline-flex",alignItems:"center",gap:7,
                height:36,padding:"0 16px",borderRadius:8,
                fontSize:12,fontWeight:700,cursor:"pointer",
                whiteSpace:"nowrap",
                background:active?C.navy():"transparent",
                border:"none",
                color:active?C.linen():C.txt("muted"),
                boxShadow:active?`0 2px 8px ${C.navy(0.3)}`:"none",
                transition:"all 0.15s",
              }}>
              <TIcon size={13}/>{tab.label}
            </button>
          );
        })}
      </div>

      {/* —— TAB: Overview ———————————————————————————————————————————————————————————— */}
      {activeTab==="overview" && (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:16,
            flexWrap:"wrap"}}
            className="db-grid-responsive">
            <style>{`@media(max-width:900px){.db-grid-responsive{grid-template-columns:1fr!important}}`}</style>

            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title="Pass / Fail Split"/>
              <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
                <div style={{position:"relative",width:160,height:160,minWidth:1,minHeight:1}}>
                  <SafeChart height={160}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%"
                        innerRadius={50} outerRadius={75}
                        paddingAngle={3} dataKey="value" strokeWidth={0}
                        labelLine={false}>
                        <Cell fill={C.ok()} />
                        <Cell fill={C.ng()} />
                        <Cell fill={C.amber()} />
                      </Pie>
                      <Tooltip {...TooltipStyle}/>
                    </PieChart>
                  </ResponsiveContainer>
                  </SafeChart>
                  <div style={{position:"absolute",inset:0,display:"flex",
                    flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <p style={{fontSize:22,fontWeight:800,color:C.txt("pri"),
                      fontFamily:"'DM Mono',monospace",lineHeight:1}}>{efficiency}%</p>
                    <p style={{fontSize:10,color:C.txt("muted"),marginTop:2}}>Quality Rate</p>
                  </div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                {[
                  { label:"Pass",    value:summary.quality?.ok||0,       color:C.ok()    },
                  { label:"Fail",    value:summary.quality?.ng||0,       color:C.ng()    },
                  { label:"Blocked", value:summary.parts?.interlocked||0,color:C.amber() },
                ].map(s=>(
                  <div key={s.label} style={{background:C.bg("surf"),
                    border:`1px solid ${C.bdr()}`,borderRadius:10,
                    padding:"10px 8px",textAlign:"center"}}>
                    <p style={{fontSize:20,fontWeight:800,color:s.color,
                      fontFamily:"'DM Mono',monospace",lineHeight:1}}>{s.value}</p>
                    <p style={{fontSize:9,color:C.txt("muted"),marginTop:4,fontWeight:700,
                      textTransform:"uppercase",letterSpacing:"0.07em"}}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title={isMultiDayRange ? "Production Trend" : "Hourly Production"}
                right={
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <ChartModeToggle mode={chartModeHourly} onChange={setChartModeHourly} />
                    <div style={{width:6,height:6,borderRadius:"50%",background:C.ok(),
                      animation:"dbPing 1.6s ease-out infinite",opacity:0.7}}/>
                    <span style={{fontSize:11,color:C.ok(),fontWeight:700}}>Live</span>
                  </div>
                }
              />
              <SafeChart height={220}>
                <div style={{ width: "100%", height: 220, minWidth: 1, minHeight: 1 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                  {chartModeHourly === "line" && (
                    <LineChart data={productionTrendData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey={isMultiDayRange ? "date" : "hour"} tickFormatter={h=>isMultiDayRange ? String(h).slice(5) : `${String(h).padStart(2,"0")}:00`} tick={{fontSize:11,fill:C.txt("sec"),fontFamily:"'DM Mono',monospace"}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <Tooltip {...TooltipStyle} labelFormatter={h=>isMultiDayRange ? String(h) : `${String(h).padStart(2,"0")}:00`}/>
                      <Line type="monotone" dataKey="ok" stroke={C.ok()} strokeWidth={2.5} dot={false} activeDot={{r:4,fill:C.ok()}}/>
                      <Line type="monotone" dataKey="ng" stroke={C.ng()} strokeWidth={2} dot={false} strokeDasharray="4 3" activeDot={{r:4,fill:C.ng()}}/>
                      <Line type="monotone" dataKey="total" stroke={C.steel()} strokeWidth={1.5} dot={false} strokeDasharray="2 4" activeDot={{r:4,fill:C.steel()}}/>
                    </LineChart>
                  )}
                  {chartModeHourly === "bar" && (
                    <BarChart data={productionTrendData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey={isMultiDayRange ? "date" : "hour"} tickFormatter={h=>isMultiDayRange ? String(h).slice(5) : `${String(h).padStart(2,"0")}:00`} tick={{fontSize:11,fill:C.txt("sec"),fontFamily:"'DM Mono',monospace"}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <Tooltip {...TooltipStyle} labelFormatter={h=>isMultiDayRange ? String(h) : `${String(h).padStart(2,"0")}:00`}/>
                      <Bar dataKey="ok" fill={C.ok()} radius={[4,4,0,0]} />
                      <Bar dataKey="ng" fill={C.ng()} radius={[4,4,0,0]} />
                      <Bar dataKey="total" fill={C.steel(0.6)} radius={[4,4,0,0]} />
                    </BarChart>
                  )}
                  {chartModeHourly === "area" && (
                    <AreaChart data={productionTrendData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey={isMultiDayRange ? "date" : "hour"} tickFormatter={h=>isMultiDayRange ? String(h).slice(5) : `${String(h).padStart(2,"0")}:00`} tick={{fontSize:11,fill:C.txt("sec"),fontFamily:"'DM Mono',monospace"}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <Tooltip {...TooltipStyle} labelFormatter={h=>isMultiDayRange ? String(h) : `${String(h).padStart(2,"0")}:00`}/>
                      <Area type="monotone" dataKey="ok" stroke={C.ok()} fill={C.ok(0.25)} />
                      <Area type="monotone" dataKey="ng" stroke={C.ng()} fill={C.ng(0.2)} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
                </div>
              </SafeChart>
              <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                {[
                  {color:C.ok(),   label:"Pass"},
                  {color:C.ng(),   label:"Fail"},
                  {color:C.steel(),label:"Total"},
                ].map(l=>(
                  <div key={l.label} style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:18,height:2.5,borderRadius:2,background:l.color}}/>
                    <span style={{fontSize:11,color:C.txt("muted"),fontWeight:600}}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}
            className="db-grid-2">
            <style>{`@media(max-width:800px){.db-grid-2{grid-template-columns:1fr!important}}`}</style>

            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title="Production by Shift" right={<ChartModeToggle mode={chartModeShift} onChange={setChartModeShift} />} />
              <SafeChart height={200}>
                <div style={{ width: "100%", height: 200, minWidth: 1, minHeight: 1 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                  {chartModeShift === "bar" && (
                    <BarChart data={shiftData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey="name" tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <Tooltip {...TooltipStyle}/>
                      <Bar dataKey="actual" fill={C.ok()} radius={[4,4,0,0]} barSize={24}/>
                      <Bar dataKey="target" fill={C.steel(0.7)} radius={[4,4,0,0]} barSize={24}/>
                    </BarChart>
                  )}
                  {chartModeShift === "line" && (
                    <LineChart data={shiftData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey="name" tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <Tooltip {...TooltipStyle}/>
                      <Line type="monotone" dataKey="actual" stroke={C.ok()} strokeWidth={2.4} />
                      <Line type="monotone" dataKey="target" stroke={C.steel()} strokeWidth={2.2} />
                    </LineChart>
                  )}
                  {chartModeShift === "area" && (
                    <AreaChart data={shiftData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey="name" tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                      <Tooltip {...TooltipStyle}/>
                      <Area type="monotone" dataKey="actual" stroke={C.ok()} fill={C.ok(0.25)} />
                      <Area type="monotone" dataKey="target" stroke={C.steel()} fill={C.steel(0.2)} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
                </div>
              </SafeChart>
            </div>

            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title={t("dashboard.topRejectionReasons", "Top Rejection Reasons")}/>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {(report.recentScans||[]).filter(r=>r.result==="NG").slice(0,5).map((row,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"10px 12px",background:C.bg("surf"),borderRadius:10,border:`1px solid ${C.bdr()}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:C.ng()}}/>
                      <span style={{fontSize:12,fontWeight:700,color:C.txt("pri")}}>{row.reason || "Unknown Defect"}</span>
                    </div>
                    <span style={{fontSize:10,fontWeight:800,color:C.txt("muted"),fontFamily:"'DM Mono',monospace"}}>
                      {row.partId}
                    </span>
                  </div>
                ))}
                {(report.recentScans||[]).filter(r=>r.result==="NG").length === 0 && (
                  <p style={{fontSize:12, color:C.txt("muted"), textAlign:"center", py:10}}>No rejects found in this period.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* —— TAB: Machines ——————————————————————————————————————————————————————————— */}
      {activeTab==="machines" && (
        <div className="db-tablet-cards" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16}}>
          {report.machineCards.map((row)=>(
            <MachineCard
              key={row.machineId}
              row={row}
              plcOnline={Object.prototype.hasOwnProperty.call(plcMap, row.machineId) ? plcMap[row.machineId] : (row.plcConnected ?? null)}
              scannerOnline={row.scannerConnected ?? null}
              nowMs={nowMs}
            />
          ))}
        </div>
      )}

      {activeTab==="oee" && (
        <div className="db-tablet-oeeoa" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:16}}>
          {analysisMachineRows.map((row, idx)=>{
            const oee = Number(row?.oee ?? row?.OEE ?? 0);
            const availability = Number(row?.availability ?? row?.Availability ?? 0);
            const performance = Number(row?.performance ?? row?.Performance ?? 0);
            const quality = Number(row?.quality ?? row?.Quality ?? 0);
            const stationName = row?.stationNo || row?.station || row?.machineName || `Station ${idx + 1}`;
            const oeeClamped = Math.max(0, Math.min(100, oee));
            const makePie = (value) => {
              const v = Math.max(0, Math.min(100, Number(value || 0)));
              return [{ name: "Effective", value: v }, { name: "Loss", value: 100 - v }];
            };
            return (
              <div key={`${stationName}-${idx}`} className="db-tablet-pad" style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14,padding:16,boxShadow:SHADOW}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <p style={{fontSize:13,fontWeight:800,color:C.txt("pri"),margin:0}}>{stationName}</p>
                  <Badge variant={oee>=85 ? "ok" : oee>=60 ? "wip" : "ng"} label={`OEE ${Math.round(oee)}%`} />
                </div>
                <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
                  <div style={{width:150,height:150,position:"relative"}}>
                    <div style={{ width: "100%", height: "100%", minWidth: 1, minHeight: 1 }}>
                      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                        <PieChart>
                          <Pie data={makePie(oeeClamped)} dataKey="value" innerRadius={46} outerRadius={66} startAngle={90} endAngle={-270} strokeWidth={0}>
                            <Cell fill={oeeClamped>=85 ? C.ok() : oeeClamped>=60 ? C.amber() : C.ng()} />
                            <Cell fill={C.bdr(0.18)} />
                          </Pie>
                          <Tooltip {...TooltipStyle} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                      <span style={{fontSize:22,fontWeight:800,color:C.txt("pri"),fontFamily:"'DM Mono',monospace"}}>{Math.round(oeeClamped)}%</span>
                      <span style={{fontSize:10,color:C.txt("muted"),textTransform:"uppercase",letterSpacing:"0.06em"}}>Overall OEE</span>
                    </div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                  {[{label:"Availability",value:availability,color:C.steel()},{label:"Performance",value:performance,color:C.amber()},{label:"Quality",value:quality,color:C.ok()}].map((m)=>(
                    <div key={m.label} style={{background:C.bg("surf"),border:`1px solid ${C.bdr()}`,borderRadius:9,padding:"8px 6px",textAlign:"center"}}>
                      <div style={{width:66,height:66,margin:"0 auto 6px"}}>
                        <div style={{ width: "100%", height: "100%", minWidth: 1, minHeight: 1 }}>
                          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                            <PieChart>
                              <Pie data={makePie(m.value)} dataKey="value" innerRadius={18} outerRadius={30} startAngle={90} endAngle={-270} strokeWidth={0}>
                                <Cell fill={m.color} />
                                <Cell fill={C.bdr(0.16)} />
                              </Pie>
                              <Tooltip {...TooltipStyle} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <p style={{fontSize:14,fontWeight:800,color:C.txt("pri"),margin:0,fontFamily:"'DM Mono',monospace"}}>{Math.round(m.value)}%</p>
                      <p style={{fontSize:9,fontWeight:700,color:C.txt("muted"),marginTop:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>{m.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {activeTab==="oa" && (
        <div className="db-tablet-oeeoa" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:16}}>
          {analysisMachineRows.map((row, idx)=>{
            const oa = Number(row?.oa ?? row?.OA ?? 0);
            const stationName = row?.stationNo || row?.station || row?.machineName || `Station ${idx + 1}`;
            const oaClamped = Math.max(0, Math.min(100, oa));
            const makePie = (value) => {
              const v = Math.max(0, Math.min(100, Number(value || 0)));
              return [{ name: "Effective", value: v }, { name: "Loss", value: 100 - v }];
            };
            return (
              <div key={`${stationName}-oa-${idx}`} className="db-tablet-pad" style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14,padding:16,boxShadow:SHADOW}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <p style={{fontSize:13,fontWeight:800,color:C.txt("pri"),margin:0}}>{stationName}</p>
                  <Badge variant={oa>=85 ? "ok" : oa>=60 ? "wip" : "ng"} label={`OA ${Math.round(oa)}%`} />
                </div>
                <SafeChart height={180}>
                  <div style={{ width: "100%", height: 180, minWidth: 1, minHeight: 1 }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                      <PieChart>
                        <Pie data={makePie(oaClamped)} dataKey="value" innerRadius={50} outerRadius={72} startAngle={90} endAngle={-270} strokeWidth={0}>
                          <Cell fill={oaClamped>=85 ? C.ok() : oaClamped>=60 ? C.amber() : C.ng()} />
                          <Cell fill={C.bdr(0.18)} />
                        </Pie>
                        <Tooltip {...TooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </SafeChart>
                <div style={{marginTop:8,display:"flex",gap:8,flexWrap:"wrap"}}>
                  <Badge variant={oa>=85 ? "ok" : oa>=60 ? "wip" : "ng"} label={oa>=85 ? "Healthy" : oa>=60 ? "Watch" : "Critical"} />
                  <Badge variant="idle" label={`${t("dashboard.downtime", "Downtime")} ${Math.round(Number(row?.downtimeMinutes || 0))}m`} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab==="rejection" && (
        <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:16}} className="db-grid-responsive">
          <style>{`@media(max-width:900px){.db-grid-responsive{grid-template-columns:1fr!important}}`}</style>
          <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14,padding:20,boxShadow:SHADOW}}>
            <SectionHead title={t("dashboard.rejectionDistribution", "Rejection Distribution")}/>
            <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
              <SafeChart height={200}>
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                  <PieChart>
                    <Pie data={rejectionPieData} dataKey="value" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}
                      labelLine={false}>
                      {rejectionPieData.map((entry) => (<Cell key={entry.name} fill={entry.color} />))}
                    </Pie>
                    <Tooltip {...TooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </SafeChart>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {rejectionPieData.map((row) => {
                const total = rejectionPieData.reduce((s, e) => s + Number(e.value || 0), 0);
                const pct = total > 0 ? Math.round((Number(row.value || 0) / total) * 100) : 0;
                return (
                <div key={row.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",borderRadius:9,background:C.bg("surf"),border:`1px solid ${C.bdr()}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:row.color}} />
                    <span style={{fontSize:12,fontWeight:700,color:C.txt("pri")}}>{row.name}</span>
                  </div>
                  <span style={{fontSize:12,fontWeight:800,color:C.txt("sec"),fontFamily:"'DM Mono',monospace"}}>{row.value} ({pct}%)</span>
                </div>
              )})}
            </div>
          </div>

          <div style={{display:"grid",gridTemplateRows:"220px auto",gap:16}}>
            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title={isMultiDayRange ? t("dashboard.rejectionTrendByDay", "Rejection Trend by Day") : t("dashboard.rejectionTrendByHour", "Rejection Trend by Hour")} right={<ChartModeToggle mode={chartModeRejectTrend} onChange={setChartModeRejectTrend} />} />
              <SafeChart height={180}>
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                {chartModeRejectTrend === "area" && (
                  <AreaChart data={rejectionTrendData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                    <XAxis dataKey={isMultiDayRange ? "date" : "slot"} tickFormatter={(v)=>isMultiDayRange ? String(v).slice(5) : v} tick={{fontSize:10,fill:C.txt("sec"),fontFamily:"'DM Mono',monospace"}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fontSize:10,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                    <Tooltip {...TooltipStyle}/>
                    <Area type="monotone" dataKey="cr" stackId="1" stroke={C.ng()} fill={C.ng(0.35)} />
                    <Area type="monotone" dataKey="cram" stackId="1" stroke={C.amber()} fill={C.amber(0.35)} />
                    <Area type="monotone" dataKey="mr" stackId="1" stroke={C.steel()} fill={C.steel(0.35)} />
                  </AreaChart>
                )}
                {chartModeRejectTrend === "line" && (
                  <LineChart data={rejectionTrendData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                    <XAxis dataKey={isMultiDayRange ? "date" : "slot"} tickFormatter={(v)=>isMultiDayRange ? String(v).slice(5) : v} tick={{fontSize:10,fill:C.txt("sec"),fontFamily:"'DM Mono',monospace"}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fontSize:10,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                    <Tooltip {...TooltipStyle}/>
                    <Line type="monotone" dataKey="cr" stroke={C.ng()} strokeWidth={2.2} />
                    <Line type="monotone" dataKey="cram" stroke={C.amber()} strokeWidth={2.2} />
                    <Line type="monotone" dataKey="mr" stroke={C.steel()} strokeWidth={2.2} />
                  </LineChart>
                )}
                {chartModeRejectTrend === "bar" && (
                  <BarChart data={rejectionTrendData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                    <XAxis dataKey={isMultiDayRange ? "date" : "slot"} tickFormatter={(v)=>isMultiDayRange ? String(v).slice(5) : v} tick={{fontSize:10,fill:C.txt("sec"),fontFamily:"'DM Mono',monospace"}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fontSize:10,fill:C.txt("sec")}} axisLine={false} tickLine={false}/>
                    <Tooltip {...TooltipStyle}/>
                    <Bar dataKey="cr" fill={C.ng()} radius={[3,3,0,0]} />
                    <Bar dataKey="cram" fill={C.amber()} radius={[3,3,0,0]} />
                    <Bar dataKey="mr" fill={C.steel()} radius={[3,3,0,0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
              </SafeChart>
            </div>

            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title={t("dashboard.topRejectionReasons", "Top Rejection Reasons")}/>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {rejectionTopReasons.map((row,i)=>(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",alignItems:"center",padding:"10px 12px",background:C.bg("surf"),borderRadius:10,border:`1px solid ${C.bdr()}`}}>
                    <span style={{fontSize:12,fontWeight:700,color:C.txt("pri"),whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{row.reason}</span>
                    <span style={{fontSize:11,fontWeight:800,color:C.txt("sec"),fontFamily:"'DM Mono',monospace"}}>{row.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;

