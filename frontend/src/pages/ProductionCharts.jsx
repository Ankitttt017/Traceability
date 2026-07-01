// ============================================================
//  ProductionCharts.jsx — IndusTrace Premium v4
//  ? Download bar at TOP
//  ? Tabs: Overview | Hourly | Machine | Shift | Parts List
//  ? Excel exports: Full / Parts / Audit
//  ? Navy/Steel/Amber/Linen theme
// ============================================================
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  TrendingUp, Download, RefreshCw, BarChart3,
  LineChart as LineChartIcon, AlertCircle, Clock,
  Cpu, Target, Activity, Table2,
  CheckCircle2, XCircle, Package, Zap,
  PieChart as PieIcon, Settings2, Calendar,
  List, LayoutDashboard, TrendingDown, Eye, X,
} from "lucide-react";
import {
  LineChart as ReLineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart as RePieChart,
  Pie, Cell, AreaChart, Area, Legend,
} from "recharts";
import { dashboardApi, machineApi, reportApi } from "../api/services";
import { CHART_COLORS, STATUS_COLORS } from "../constants/chartTheme";
import SafeChart from "../components/charts/SafeChart";
import PlantLineSelector from "../components/PlantLineSelector";
import { SOCKET_URL } from "../constants/network";
import { useLanguage } from "../context/LanguageContext";

// -- Design tokens ----------------------------------------------------------
const DS = `
  @keyframes pcSpin   { to{transform:rotate(360deg)} }
  @keyframes pcFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pcPulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
  :root{
    --pc-navy:  26,50,99;   --pc-steel: 84,119,146;
    --pc-amber: 250,185,91; --pc-linen: 232,226,219;
    --pc-ok:    34,197,94;  --pc-ng:    239,68,68;
    --pc-wip:   249,115,22; --pc-idle:  148,163,184;
  }
  [data-theme="light"]{
    --pc-bg-card:255,255,255; --pc-bg-surf:240,236,230;
    --pc-bg-input:255,255,255;
    --pc-txt-pri:26,50,99;   --pc-txt-sec:84,119,146;
    --pc-txt-muted:140,160,180;
    --pc-bdr:84,119,146; --pc-bop:0.13;
  }
  [data-theme="dark"]{
    --pc-bg-card:20,34,62; --pc-bg-surf:16,26,50;
    --pc-bg-input:14,22,44;
    --pc-txt-pri:232,226,219; --pc-txt-sec:120,160,190;
    --pc-txt-muted:84,119,146;
    --pc-bdr:84,119,146; --pc-bop:0.18;
  }
  .pc-thin-scroll{
    scrollbar-width: thin;
    scrollbar-color: rgba(var(--pc-steel),0.55) rgba(var(--pc-bg-surf),0.7);
  }
  .pc-thin-scroll::-webkit-scrollbar{
    height: 8px;
    width: 8px;
  }
  .pc-thin-scroll::-webkit-scrollbar-track{
    background: rgba(var(--pc-bg-surf),0.7);
    border-radius: 999px;
  }
  .pc-thin-scroll::-webkit-scrollbar-thumb{
    background: rgba(var(--pc-steel),0.55);
    border-radius: 999px;
  }
  .pc-thin-scroll::-webkit-scrollbar-thumb:hover{
    background: rgba(var(--pc-steel),0.8);
  }
`;
let _pcDS=false;
function injectDS(){
  if(_pcDS||typeof document==="undefined")return; _pcDS=true;
  const el=document.createElement("style");el.textContent=DS;document.head.appendChild(el);
  if(!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme","dark");
}

const C={
  navy: (o=1)=>`rgba(var(--pc-navy),${o})`,
  steel:(o=1)=>`rgba(var(--pc-steel),${o})`,
  amber:(o=1)=>`rgba(var(--pc-amber),${o})`,
  linen:(o=1)=>`rgba(var(--pc-linen),${o})`,
  ok:   (o=1)=>`rgba(var(--pc-ok),${o})`,
  ng:   (o=1)=>`rgba(var(--pc-ng),${o})`,
  wip:  (o=1)=>`rgba(var(--pc-wip),${o})`,
  idle: (o=1)=>`rgba(var(--pc-idle),${o})`,
  bg:   (v="card")=>`rgb(var(--pc-bg-${v}))`,
  txt:  (v="pri") =>`rgb(var(--pc-txt-${v}))`,
  bdr:  (o)       =>`rgba(var(--pc-bdr),${o||"var(--pc-bop)"})`,
};
const SH =`0 2px 12px rgba(var(--pc-navy),.08),0 1px 3px rgba(var(--pc-navy),.05)`;
const SHM=`0 6px 24px rgba(var(--pc-navy),.14),0 2px 8px rgba(var(--pc-navy),.07)`;
const HIDDEN_REASON_TOKENS = new Set(["RECOVERY_PENDING_AFTER_BACKEND_RESTART"]);

const DEFAULT_PLC_CYCLE_COLUMNS = [
  "machine_name","shot_date","shot_time","shot_number","cycle_time","die_close_core_in_time","pouring_time","shot_fwd_time",
  "curing_time","die_open_core_out_time","ejector_time","extract_time","spray_time","v1_speed","v2_speed","v3_speed","v4_speed",
  "metal_pressure","furnace_metal_temp","cooling_water_mov","cooling_water_sta","accel_point","deaccel_point","intensification_time",
  "biscuit_thickness","jet_cooling_pressure","clamp_tonnage_he_low_pct","clamp_tonnage_he_low_mn","clamp_tonnage_op_up_pct",
  "clamp_tonnage_op_low_pct","clamp_tonnage_he_up_pct","vacuum_pressure","clamp_force_pct","clamp_tonnage","shot_acc_pressure",
  "intensification_acc_pressure","fixed_die_temp_f1","fixed_die_temp_f2","moving_die_temp_m1","moving_die_temp_m2","slide_temp_s1",
  "fix_1_flow","fix_2_flow","fix_3_flow","mov_1_flow","mov_2_flow","mov_3_flow","vacuum_pressure_mmhg","average_die_clamp_tonnage_count",
  "time_for_stroke","stroke","shot_status"
];
const LEAK_TEST_OPERATION = "OP150";
const LEAK_TEST_SHARED_KEY = "__LEAK_TEST_OP150__";
const LEAK_TEST_COLUMNS = [
  { key: "Body_Leak_Value", label: "Body Leak Value" },
  { key: "Gall_1", label: "Gall_1" },
  { key: "Gall_2", label: "Gall_2" },
  { key: "Cycle_Time", label: "Cycle Time" },
  { key: "Running_Mode", label: "Running Mode" },
  { key: "Manual", label: "Manual" },
  { key: "Dry", label: "Dry" },
  { key: "Wey", label: "Wey" },
  { key: "Both", label: "Both" },
];
const getLeakTestStatus = (reading) => {
  const result = String(reading?.Result || reading?.result || "").trim().toUpperCase();
  if (result === "OK") return "OK";
  if (result === "NG") return "NG";
  if (!reading) return "";
  return "IN_PROGRESS";
};
const getLeakTestValue = (reading, key) => {
  if (!reading) return "—";
  if (key === "Machine") {
    return reading.Machine || reading.machineName || reading.matchedMachineName || "—";
  }
  if (key === "Cycle_End_Time") {
    const raw = reading.Cycle_End_Time || reading.cycleEndTime || "";
    if (!raw) return "—";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? String(raw) : parsed.toLocaleString("en-IN");
  }
  const value = reading[key];
  return value === undefined || value === null || value === "" ? "—" : value;
};

// -- Helpers ----------------------------------------------------------------
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function toDateRange(r){
  const now = new Date();
  const mesStart = new Date(now);
  mesStart.setHours(6, 0, 0, 0);
  if (now < mesStart) mesStart.setDate(mesStart.getDate() - 1);
  const mesEnd = new Date(mesStart);
  mesEnd.setDate(mesEnd.getDate() + 1);

  const from = new Date(now);
  if (r === "daily") {
    from.setTime(mesStart.getTime());
    return { dateFrom: from.toISOString(), dateTo: mesEnd.toISOString() };
  }
  if (r === "weekly") {
    from.setDate(mesStart.getDate() - 6);
    from.setHours(6, 0, 0, 0);
  } else {
    from.setDate(mesStart.getDate() - 29);
    from.setHours(6, 0, 0, 0);
  }
  return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
}

function formatPlcColumnLabel(key){
  const raw = String(key || "").trim();
  if (!raw) return "PLC";
  const friendly = {
    machine_name: "Machine Name",
    part_name: "Part Name",
    shot_date: "Shot Date",
    shot_time: "Shot Time",
    shot_number: "Shot Number",
    shot_status: "Shot Status",
  };
  if (friendly[raw]) return friendly[raw];
  return raw
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w ? (w.charAt(0).toUpperCase() + w.slice(1)) : w)
    .join(" ");
}

function renderCellValue(value){
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
const sanitizeDisplayReason = (value) => {
  const raw = String(value || "").trim();
  const normalized = raw.toUpperCase();
  if (!raw || raw === "-" || HIDDEN_REASON_TOKENS.has(normalized)) return "";
  return raw;
};
const extractShotFromPartId = (partId) => {
  const s = String(partId || "").trim();
  if (!s) return "";
  const machineCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machineCode>[A-Z0-9]{1})(?<shot>\d{1,6})$/i);
  if (machineCompact?.groups?.shot) return String(machineCompact.groups.shot).trim();
  const legacyCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<shot>\d{1,6})$/);
  if (legacyCompact?.groups?.shot) return String(legacyCompact.groups.shot).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length > 12) return digits.slice(12);
  return "";
};
const fmtH  =h=>(h!==undefined&&h!==null&&!Number.isNaN(Number(h)))?`${String(Number(h)).padStart(2,"0")}:00`:String(h||"");
const fmtNow=()=>new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
const dateStr=()=>new Date().toISOString().slice(0,10);
const localDateTimeToIso = (value) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

// -- Tooltip ----------------------------------------------------------------
const TipBox=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return(
    <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:10,
      padding:"10px 14px",boxShadow:SHM,fontSize:12}}>
      {label!==undefined&&<p style={{fontSize:11,fontWeight:700,color:C.txt("sec"),marginBottom:6}}>{fmtH(label)}</p>}
      {payload.map((p,i)=>(
        <p key={i} style={{color:p.color||C.txt("pri"),marginBottom:2}}>
          <span style={{fontWeight:600}}>{p.name}: </span>
          <span style={{fontFamily:"'DM Mono',monospace",fontWeight:800}}>{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// -- Card -------------------------------------------------------------------
const Card=({title,subtitle,icon:Icon,accent,right,children,noPad})=>(
  <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
    borderRadius:14,overflow:"hidden",boxShadow:SH,
    borderLeft:accent?`3px solid ${accent}`:"none"}}>
    {(title||right)&&(
      <div style={{padding:"12px 17px",borderBottom:`1px solid ${C.bdr()}`,
        background:C.bg("surf"),display:"flex",alignItems:"center",
        justifyContent:"space-between",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {Icon&&<div style={{width:28,height:28,borderRadius:7,background:C.navy(0.1),
            border:`1px solid ${C.navy(0.18)}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Icon size={13} color={C.steel()}/>
          </div>}
          <div>
            {subtitle&&<p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.09em",color:C.txt("muted"),marginBottom:1}}>{subtitle}</p>}
            <p style={{fontSize:13,fontWeight:700,color:C.txt("pri")}}>{title}</p>
          </div>
        </div>
        {right}
      </div>
    )}
    <div style={noPad?{}:{padding:17}}>{children}</div>
  </div>
);

// -- KPI card ---------------------------------------------------------------
const KpiCard=({label,value,sub,color,bgC,bdC,icon:Icon})=>{
  const[h,setH]=useState(false);
  return(
    <div style={{background:bgC||C.bg("card"),border:`1px solid ${bdC||C.bdr()}`,
      borderRadius:13,padding:"14px 16px",borderLeft:`3px solid ${color}`,
      boxShadow:h?SHM:SH,transform:h?"translateY(-2px)":"none",transition:"all .15s"}}
      onMouseEnter={()=>setH(true)}onMouseLeave={()=>setH(false)}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8}}>
        <p style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.09em",color,lineHeight:1.3}}>{label}</p>
        {Icon&&<div style={{width:30,height:30,borderRadius:8,flexShrink:0,
          background:`${color.replace("1)","0.12)")}`,
          display:"flex",alignItems:"center",justifyContent:"center",color}}>
          <Icon size={14}/>
        </div>}
      </div>
      <p style={{fontSize:28,fontWeight:900,color,lineHeight:1,fontFamily:"'DM Mono',monospace",marginBottom:5}}>{value}</p>
      {sub&&<p style={{fontSize:10,color:C.txt("muted")}}>{sub}</p>}
    </div>
  );
};

// -- Shift card -------------------------------------------------------------
const ShiftCard=({label,row,colorFn,icon:SIcon,t})=>{
  const total=Number(row?.total||0),ok=Number(row?.ok||0),ng=total-ok,eff=total>0?Math.round(ok/total*100):0;
  return(
    <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
      borderLeft:`3px solid ${colorFn()}`,borderRadius:12,padding:"14px 16px",boxShadow:SH}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,borderRadius:7,background:colorFn(0.1),
            border:`1px solid ${colorFn(0.25)}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <SIcon size={13} color={colorFn()}/>
          </div>
          <div>
            <p style={{fontSize:12,fontWeight:700,color:C.txt("pri")}}>{label}</p>
            <p style={{fontSize:10,color:C.txt("muted")}}>Production</p>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <p style={{fontSize:18,fontWeight:900,color:colorFn(),fontFamily:"'DM Mono',monospace",lineHeight:1}}>{total}</p>
          <p style={{fontSize:9,color:C.txt("muted"),marginTop:1}}>units</p>
        </div>
      </div>
      <div style={{height:5,borderRadius:99,background:C.bdr(0.14),overflow:"hidden",marginBottom:7,display:"flex"}}>
        <div style={{background:C.ok(),height:"100%",width:`${total>0?ok/total*100:0}%`,transition:"width .5s"}}/>
        <div style={{background:C.ng(),height:"100%",width:`${total>0?ng/total*100:0}%`,transition:"width .5s"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
        <span style={{color:C.ok(),fontWeight:700}}>? {ok} {t("production.pass", "Pass")}</span>
        <span style={{color:C.ng(),fontWeight:700}}>? {ng} {t("production.fail", "Fail")}</span>
        <span style={{fontWeight:800,fontFamily:"'DM Mono',monospace",
          color:eff>=85?C.ok():eff>=60?C.wip():C.ng()}}>{eff}%</span>
      </div>
    </div>
  );
};

// -- Badge ------------------------------------------------------------------
const Bdg=({v="idle",l})=>{
  const m={ok:{fg:C.ok(),bg:C.ok(0.1),bd:C.ok(0.25)},ng:{fg:C.ng(),bg:C.ng(0.1),bd:C.ng(0.25)},
    wip:{fg:C.wip(),bg:C.wip(0.1),bd:C.wip(0.25)},idle:{fg:C.idle(),bg:C.idle(0.08),bd:C.idle(0.2)}};
  const s=m[v]||m.idle;
  return<span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 9px",
    borderRadius:99,fontSize:11,fontWeight:700,color:s.fg,background:s.bg,border:`1px solid ${s.bd}`}}>
    <span style={{width:5,height:5,borderRadius:"50%",background:s.fg}}/>{l}</span>;
};

// --------------------------------------------------------------------------
//  MAIN COMPONENT
// --------------------------------------------------------------------------
const ProductionCharts=()=>{
  injectDS();
  const { t } = useLanguage();

  const[timeRange, setTimeRange] =useState("weekly");
  const[customDate,setCustomDate]=useState({from:"",to:""});
  const[chartType, setChartType] =useState("bar");
  const[activeTab, setActiveTab] =useState("overview");
  const[loading,   setLoading]   =useState(false);
  const[error,     setError]     =useState("");
  const[machines,  setMachines]  =useState([]);
  const[partsList, setPartsList] =useState([]);
  const[reportRows, setReportRows] =useState([]);
  const[partsSearch,setPartsSearch]=useState("");
  const[partsFilter,setPartsFilter]=useState("all");
  const[partsPage,setPartsPage]=useState(1);
  const[partsPageSize,setPartsPageSize]=useState(25);
  const[selectedMachineDetail,setSelectedMachineDetail]=useState(null);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const lastRefreshAtRef = useRef(0);
  const[filters,setFilters]=useState({
    plantId:"",
    lineId:"",
    machineId:"",
    lineName:"",
    partId:"",
    status:"",
    shiftCode:"",
  });

  const[summary,setSummary]=useState({
    machines:{total:0,active:0,inactive:0},
    parts:{inProgress:0,completed:0,ng:0,interlocked:0,rework:0},
    quality:{ok:0,ng:0},
  });
  const[report,setReport]=useState({
    machineWise:[],hourlyProduction:[],
    shiftProduction:{SHIFT_A:{total:0,ok:0,ng:0},SHIFT_B:{total:0,ok:0,ng:0},SHIFT_C:{total:0,ok:0,ng:0}},
    shiftWiseMetrics:[],
    dayWiseMetrics:[],
    stationWiseMetrics:[],
    availableLines:[],
    availableShifts:[],
    partsList:[],
    plcReadingColumns:[],
  });

  const consolidatePartsList = useCallback((rows = []) => {
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const ta = new Date(a?.createdAt || a?.createdAtRaw || 0).getTime() || 0;
      const tb = new Date(b?.createdAt || b?.createdAtRaw || 0).getTime() || 0;
      return tb - ta;
    });
  }, []);

  const query=useMemo(()=>{
    const commonFilters = {
      machineId: filters.machineId || undefined,
      plantId: filters.plantId || undefined,
      lineId: filters.lineId || undefined,
      lineName: filters.lineName || undefined,
      partId: filters.partId || undefined,
      status: filters.status || undefined,
      shiftCode: filters.shiftCode || undefined,
    };
    if(timeRange==="custom"&&customDate.from&&customDate.to){
      return{
        dateFrom:localDateTimeToIso(customDate.from),
        dateTo:localDateTimeToIso(customDate.to),
        ...commonFilters,
      };
    }
    return { ...toDateRange(timeRange), ...commonFilters };
  },[timeRange,customDate,filters]);

  const loadData=useCallback(async()=>{
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    setLoading(true);setError("");
    try{
      const[s,r,m,reportData]=await Promise.all([
        dashboardApi.summary(query),
        dashboardApi.report(query),
        machineApi.list(),
        reportApi.getData(query),
      ]);
      setSummary(s||summary);
      setReport(r||report);
      setMachines(m||[]);
      setReportRows(Array.isArray(reportData?.rows) ? reportData.rows : []);
      // Load parts list if available
      try{
        const parts=await dashboardApi.partsList?.(query)||r?.partsList||[];
        const reportRows = Array.isArray(reportData?.rows) ? reportData.rows : [];
        const reportByPartId = reportRows.reduce((acc, row) => {
          const key = String(row?.partId || row?.part_id || "").trim();
          if (!key) return acc;
          const prev = acc[key];
          const currentTs = new Date(row?.createdAt || 0).getTime() || 0;
          const prevTs = prev ? (new Date(prev?.createdAt || 0).getTime() || 0) : -1;
          if (!prev || currentTs >= prevTs) acc[key] = row;
          return acc;
        }, {});
        const mergedParts = (Array.isArray(parts) ? parts : []).map((part) => {
          const key = String(part?.partId || part?.part_id || "").trim();
          const reportRow = reportByPartId[key] || {};
          return {
            ...part,
            customerQrCode: part?.customerQrCode || reportRow?.customerQrCode || reportRow?.customerCode || reportRow?.customer_qr || null,
            partName: part?.partName || reportRow?.partName || reportRow?.componentName || null,
            machineName: part?.machineName || reportRow?.machineName || null,
            plcReading: part?.plcReading || reportRow?.plcReading || null,
          };
        });
        setPartsList(consolidatePartsList(mergedParts));
      }catch{}
    }catch(e){setError(e.response?.data?.error||t("production.failedLoadAnalytics", "Failed to load analytics data."));}
    finally{
      setLoading(false);
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        loadData();
      }
    }
  },[consolidatePartsList, query, t]);

  const scheduleRefresh = useCallback((cooldownMs = 350) => {
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
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  },[scheduleRefresh]);

  useEffect(() => {
    const sock = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["polling"], upgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    sock.on("dashboard_refresh", () => scheduleRefresh(450));
    return () => sock.close();
  }, [scheduleRefresh]);

  const machineMap=useMemo(()=>new Map(machines.map(m=>[Number(m.id),m])),[machines]);
  const lineContextLabel = useMemo(() => {
    const selectedMachineId = Number(filters.machineId || 0);
    if (selectedMachineId) {
      const selected = machines.find((m) => Number(m.id) === selectedMachineId);
      if (selected?.lineName) {
        return `${t("production.lineLabel", "Line")}: ${selected.lineName}`;
      }
    }
    if (filters.lineName) {
      return `${t("production.lineLabel", "Line")}: ${filters.lineName}`;
    }
    const lineSet = new Set((machines || []).map((m) => String(m.lineName || "").trim()).filter(Boolean));
    if (lineSet.size === 0) return `${t("production.lineLabel", "Line")}: ${t("production.all", "All")}`;
    if (lineSet.size === 1) return `${t("production.lineLabel", "Line")}: ${Array.from(lineSet)[0]}`;
    return `${t("production.lineLabel", "Line")}: ${t("production.all", "All")} (${lineSet.size})`;
  }, [filters.lineName, filters.machineId, machines, t]);
  const summaryTotalOk   =Number(summary.quality?.ok||0);
  const summaryTotalNg   =Number(summary.quality?.ng||0);
  const summaryTotalUnits=summaryTotalOk+summaryTotalNg;
  const summaryEfficiency=summaryTotalUnits>0?Math.round(summaryTotalOk/summaryTotalUnits*100):0;

  const qualityPie=useMemo(()=>[
    {name:t("production.passOk", "Pass (OK)"),value:summaryTotalOk},
    {name:t("production.failNg", "Fail (NG)"),value:summaryTotalNg},
  ],[summaryTotalOk,summaryTotalNg,t]);

  const productionData=useMemo(()=>
    (report.hourlyProduction||[]).map(r=>({
      hour:fmtH(r.hour),Pass:Number(r.ok||0),Fail:Number(r.ng||0),Total:Number(r.total||0),
    })),[report.hourlyProduction]);

  const machinePerformanceRows = useMemo(() => {
    const normalizeMachineStatus = (value, reason = "", row = null) => {
      const s = String(value || "").trim().toUpperCase();
      const r = String(reason || "").trim().toUpperCase();
      const bypassStatus = Boolean(row?.bypassStatus || row?.is_bypassed || row?.isBypassed);
      const bypassReason = String(row?.bypassReason || row?.bypass_reason || "").trim().toUpperCase();
      if (bypassStatus || ["MACHINE_BYPASS_AUTO_OK", "STATION_BYPASS_AUTO_OK", "STATION_OPERATION_DISABLED_AUTO_OK"].includes(bypassReason)) return "OK";
      if (r === "NG_SHOT_STATUS" && ["BLOCK", "INTERLOCKED"].includes(s)) return "NG";
      if (!s) return "";
      if (["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(s)) return "OK";
      if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG", "INTERLOCKED", "REJECTED"].includes(s)) return "NG";
      if (["IN_PROGRESS", "WIP", "RUNNING", "PENDING"].includes(s)) return "IN_PROGRESS";
      return s;
    };
    const getMachineStatusPriority = (value) => {
      if (value === "OK") return 3;
      if (value === "NG") return 2;
      if (value === "IN_PROGRESS") return 1;
      return 0;
    };
    const machineCountsFromParts = new Map();
    (partsList || []).forEach((row) => {
      const machineId = Number(row?.machineId || row?.machine_id || 0);
      const partId = String(row?.partId || row?.part_id || "").trim();
      if (!machineId || !partId) return;

      const normalizedStatus = normalizeMachineStatus(
        row?.result || row?.status || row?.statusLabel || row?.industrialResult,
        row?.interlockReason || row?.reason,
        row
      );
      const createdAtMs = new Date(row?.createdAt || row?.createdAtRaw || 0).getTime() || 0;
      if (!machineCountsFromParts.has(machineId)) {
        machineCountsFromParts.set(machineId, new Map());
      }
      const byPart = machineCountsFromParts.get(machineId);
      const existing = byPart.get(partId);
      const existingTs = existing ? (new Date(existing.createdAt || existing.createdAtRaw || 0).getTime() || 0) : -1;
      const nextPriority = getMachineStatusPriority(normalizedStatus);
      const existingPriority = existing ? getMachineStatusPriority(existing.normalizedStatus) : -1;

      if (!existing || createdAtMs > existingTs || (createdAtMs === existingTs && nextPriority >= existingPriority)) {
        byPart.set(partId, {
          normalizedStatus,
          createdAt: row?.createdAt || row?.createdAtRaw || null,
        });
      }
    });

    const machineCountSummary = new Map();
    machineCountsFromParts.forEach((partMap, machineId) => {
      const summary = { ok: 0, ng: 0, inProgress: 0, interlocked: 0, produced: 0 };
      partMap.forEach((row) => {
        if (row.normalizedStatus === "OK") {
          summary.ok += 1;
        } else if (row.normalizedStatus === "NG") {
          summary.ng += 1;
        } else if (row.normalizedStatus === "IN_PROGRESS") {
          summary.inProgress += 1;
        }
      });
      summary.produced = summary.ok + summary.ng;
      machineCountSummary.set(machineId, summary);
    });

    const baseRows = Array.isArray(report.machineCards) && report.machineCards.length > 0
      ? report.machineCards.map((row) => ({
          machine_id: Number(row.machineId || row.machine_id || 0),
          machineName: String(row.machineName || row.machine_name || `Machine ${row.machineId || ""}`),
          lineName: row.lineName || row.line_name || "-",
          stationNo: row.stationNo || row.station_no || "-",
          ok: Number(row.okCount || row.ok || 0),
          ng: Number(row.ngCount || row.ng || 0),
          inProgress: Number(row.inProgressCount || 0),
          interlocked: Number(row.interlockedCount || 0),
          produced: Number(row.processedCount || row.actualProduction || 0),
          target: Number(row.targetProduction ?? row.targetQty ?? 0),
          achievementPct: Number(row.achievementPct ?? 0),
          downtimeMinutes: Number(row.downtimeMinutes || 0),
          oee: Number(row.oee || 0),
          oa: Number(row.oa || 0),
        }))
      : (() => {
          const agg = new Map();
          (report.machineWise || []).forEach((r) => {
            agg.set(Number(r.machine_id), {
              machine_id: Number(r.machine_id),
              ok: Number(r.ok || 0),
              ng: Number(r.ng || 0),
            });
          });
          return (machines || []).map((m) => {
            const id = Number(m.id);
            const perf = agg.get(id) || { machine_id: id, ok: 0, ng: 0 };
            return {
              machine_id: id,
              machineName: String(m.machineName || m.machine_name || m.machineNumber || `Machine ${id}`),
              lineName: m.lineName || m.line_name || "-",
              stationNo: m.operationNo || m.operation_no || "-",
              ok: perf.ok,
              ng: perf.ng,
              inProgress: 0,
              interlocked: 0,
              produced: Number(perf.ok || 0) + Number(perf.ng || 0),
              target: 0,
              achievementPct: 0,
              downtimeMinutes: 0,
              oee: 0,
              oa: 0,
            };
          });
        })();

    return baseRows.map((row) => {
      const derived = machineCountSummary.get(Number(row.machine_id || 0));
      if (!derived) return row;
      const produced = Number(derived.produced || 0);
      const target = Number(row.target || 0);
      return {
        ...row,
        ok: Number(derived.ok || 0),
        ng: Number(derived.ng || 0),
        inProgress: Number(derived.inProgress || 0),
        interlocked: Number(derived.interlocked || 0),
        produced,
        achievementPct: target > 0 ? Number(((produced / target) * 100).toFixed(2)) : Number(row.achievementPct || 0),
      };
    });
  }, [machines, partsList, report.machineCards, report.machineWise]);

  const machineBarData=useMemo(()=>
    machinePerformanceRows.map((r)=>({
      name: r.machineName.slice(0, 12),
      Pass: Number(r.ok || 0),
      Fail: Number(r.ng || 0),
    })),[machinePerformanceRows]);

  const shiftRowsNormalized = useMemo(() => {
    if (Array.isArray(report.shiftWiseMetrics) && report.shiftWiseMetrics.length > 0) {
      const grouped = report.shiftWiseMetrics.reduce((acc, row) => {
        const k = String(row.shiftCode || "UNASSIGNED").toUpperCase();
        if (!acc[k]) {
          acc[k] = { total: 0, ok: 0, ng: 0, target: 0, actual: 0, oee: 0, oa: 0, _count: 0 };
        }
        const actual = Number(row.actualProduction || 0);
        const target = Number(row.targetProduction || 0);
        const quality = Number(row.quality || 0);
        const ok = Math.round((actual * quality) / 100);
        const ng = Math.max(actual - ok, 0);
        acc[k].total += actual;
        acc[k].ok += ok;
        acc[k].ng += ng;
        acc[k].target += target;
        acc[k].actual += actual;
        acc[k].oee += Number(row.oee || 0);
        acc[k].oa += Number(row.oa || 0);
        acc[k]._count += 1;
        return acc;
      }, {});
      Object.values(grouped).forEach((row) => {
        row.oee = row._count > 0 ? Number((row.oee / row._count).toFixed(2)) : 0;
        row.oa = row._count > 0 ? Number((row.oa / row._count).toFixed(2)) : 0;
      });
      return grouped;
    }
    const legacy = report.shiftProduction || {};
    const normalized = {};
    Object.entries(legacy).forEach(([k, v]) => {
      normalized[k] = {
        total: Number(v?.total || 0),
        ok: Number(v?.ok || 0),
        ng: Number(v?.ng || 0),
        target: 0,
        actual: Number(v?.total || 0),
        oee: 0,
        oa: 0,
      };
    });
    return normalized;
  }, [report.shiftProduction, report.shiftWiseMetrics]);

  const timeLabel=useMemo(()=>{
    if(timeRange==="daily")return t("production.today", "Today");
    if(timeRange==="weekly")return t("production.last7Days", "Last 7 Days");
    if(timeRange==="monthly")return t("production.last30Days", "Last 30 Days");
    if(customDate.from&&customDate.to){
      const from = new Date(customDate.from);
      const to = new Date(customDate.to);
      return `${Number.isNaN(from.getTime()) ? customDate.from : from.toLocaleString("en-IN")} - ${Number.isNaN(to.getTime()) ? customDate.to : to.toLocaleString("en-IN")}`;
    }
    return t("production.custom", "Custom");
  },[customDate,timeRange,t]);
  const selectedFilterCount = useMemo(() => {
    const base = Object.values(filters).filter(Boolean).length;
    const timeFilters = (customDate.from ? 1 : 0) + (customDate.to ? 1 : 0);
    return base + timeFilters;
  }, [filters, customDate]);

  const normalizeStationResult = (value, reason = "", row = null) => {
    const s = String(value || "").trim().toUpperCase();
    const r = String(reason || "").trim().toUpperCase();
    const bypassStatus = Boolean(row?.bypassStatus || row?.is_bypassed || row?.isBypassed);
    const bypassReason = String(row?.bypassReason || row?.bypass_reason || "").trim().toUpperCase();
    if (bypassStatus || ["MACHINE_BYPASS_AUTO_OK", "STATION_BYPASS_AUTO_OK", "STATION_OPERATION_DISABLED_AUTO_OK"].includes(bypassReason)) return "OK";
    if (r === "NG_SHOT_STATUS" && ["BLOCK", "INTERLOCKED"].includes(s)) return "NG";
    if (!s) return "";
    if (["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(s)) return "OK";
    if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG", "INTERLOCKED", "REJECTED"].includes(s)) return "NG";
    if (["IN_PROGRESS", "WIP", "RUNNING", "PENDING"].includes(s)) return "IN_PROGRESS";
    return s;
  };

  const getStatusPriority = useCallback((value) => {
    if (value === "NG") return 4;
    if (value === "OK") return 3;
    if (value === "IN_PROGRESS") return 2;
    if (value) return 1;
    return 0;
  }, []);

  const getOperationStatusPriority = useCallback((value) => {
    if (value === "OK") return 3;
    if (value === "NG") return 2;
    if (value === "IN_PROGRESS") return 1;
    return 0;
  }, []);

  const aggregatedPartsList = useMemo(() => {
    const grouped = new Map();

    (partsList || []).forEach((row, idx) => {
      const partId = String(row?.partId || row?.part_id || "").trim();
      if (!partId) return;

      const machineName = (row.machineName || machineMap.get(Number(row.machineId || row.machine_id || 0))?.machineName || "").toString().trim();
      const stationNo = (row.stationNo || row.station_no || row.operationNo || row.operation_no || "").toString().trim();
      const status = normalizeStationResult(row.result || row.status || row.statusLabel || row.industrialResult, row.interlockReason || row.reason, row);
      const stationKey = `${machineName}__${stationNo}`;
      const createdAtMs = new Date(row.createdAt || 0).getTime();

      if (!grouped.has(partId)) {
        grouped.set(partId, {
          ...row,
          __sourceIndex: idx,
          partId,
          stationTimeline: [],
          createdAt: row.createdAt || null,
          latestCreatedAt: row.createdAt || null,
        });
      }

      const entry = grouped.get(partId);
      if (Number.isFinite(createdAtMs) && createdAtMs > new Date(entry.latestCreatedAt || 0).getTime()) {
        Object.assign(entry, row, {
          partId,
          stationTimeline: entry.stationTimeline,
          __sourceIndex: entry.__sourceIndex,
          createdAt: entry.createdAt || row.createdAt || null,
          latestCreatedAt: row.createdAt || null,
        });
      } else if (!entry.createdAt || (Number.isFinite(createdAtMs) && createdAtMs < new Date(entry.createdAt || 0).getTime())) {
        entry.createdAt = row.createdAt || entry.createdAt;
      }

      if (!entry.customerQrCode && (row.customerQrCode || row.customerQR || row.markingCode)) {
        entry.customerQrCode = row.customerQrCode || row.customerQR || row.markingCode;
      }
      if ((!entry.partName || entry.partName === "—") && row.partName) {
        entry.partName = row.partName;
      }
      if (!entry.plcReading && row.plcReading) {
        entry.plcReading = row.plcReading;
      } else if (entry.plcReading && row.plcReading) {
        entry.plcReading = { ...row.plcReading, ...entry.plcReading };
      }
      if (!entry.leakTestReading && row.leakTestReading) {
        entry.leakTestReading = row.leakTestReading;
      }

      const existingIdx = entry.stationTimeline.findIndex((item) => item.stationKey === stationKey);
      const timelineItem = {
        stationKey,
        machineId: row.machineId || row.machine_id || null,
        machineName,
        stationNo,
        operationNo: row.operationNo || row.operation_no || stationNo,
        status,
        result: row.result || row.status || row.statusLabel || row.industrialResult || "",
        reason: row.reason || row.interlockReason || null,
        interlockReason: row.interlockReason || row.reason || null,
        bypassReason: row.bypassReason || row.bypass_reason || null,
        bypassStatus: Boolean(row.bypassStatus || row.is_bypassed || row.isBypassed),
        createdAt: row.createdAt || null,
      };

      if (existingIdx === -1) {
        entry.stationTimeline.push(timelineItem);
      } else {
        const existing = entry.stationTimeline[existingIdx];
        const existingPriority = getStatusPriority(existing.status);
        const nextPriority = getStatusPriority(status);
        const shouldReplace =
          nextPriority > existingPriority ||
          (nextPriority === existingPriority && new Date(timelineItem.createdAt || 0).getTime() > new Date(existing.createdAt || 0).getTime());
        if (shouldReplace) {
          entry.stationTimeline[existingIdx] = timelineItem;
        }
      }

      if (entry.leakTestReading) {
        const leakMachineName = String(entry.leakTestReading.matchedMachineName || entry.leakTestReading.Machine || "").trim();
        const leakStationKey = leakMachineName ? `${leakMachineName}__${LEAK_TEST_OPERATION}` : "";
        const leakStatus = getLeakTestStatus(entry.leakTestReading);
        if (leakStationKey) {
          const leakTimelineItem = {
            stationKey: leakStationKey,
            machineId: entry.leakTestReading.matchedMachineId || null,
            machineName: leakMachineName,
            stationNo: LEAK_TEST_OPERATION,
            operationNo: LEAK_TEST_OPERATION,
            status: leakStatus,
            result: leakStatus,
            reason: null,
            interlockReason: null,
            bypassReason: null,
            bypassStatus: false,
            createdAt: entry.leakTestReading.Cycle_End_Time || entry.leakTestReading.cycleEndTime || row.createdAt || null,
          };
          const leakExistingIdx = entry.stationTimeline.findIndex((item) => item.stationKey === leakStationKey);
          if (leakExistingIdx === -1) {
            entry.stationTimeline.push(leakTimelineItem);
          } else {
            entry.stationTimeline[leakExistingIdx] = leakTimelineItem;
          }
        }
      }
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        stationTimeline: [...entry.stationTimeline].sort((a, b) =>
          String(a.stationNo || "").localeCompare(String(b.stationNo || ""), undefined, { numeric: true, sensitivity: "base" })
        ),
      }))
      .sort((a, b) => new Date(b.latestCreatedAt || b.createdAt || 0).getTime() - new Date(a.latestCreatedAt || a.createdAt || 0).getTime());
  }, [getStatusPriority, machineMap, normalizeStationResult, partsList]);

  const resolveTimelineFinalStatus = useCallback((part) => {
    const timeline = Array.isArray(part?.stationTimeline) && part.stationTimeline.length
      ? part.stationTimeline
      : [{
          status: part?.status || part?.statusLabel || part?.result || part?.industrialResult || "",
          result: part?.result || part?.status || part?.statusLabel || part?.industrialResult || "",
          reason: part?.interlockReason || part?.reason || "",
          interlockReason: part?.interlockReason || part?.reason || "",
          bypassReason: part?.bypassReason || part?.bypass_reason || "",
          bypassStatus: Boolean(part?.bypassStatus || part?.is_bypassed || part?.isBypassed),
          operationNo: part?.operationNo || part?.stationNo || "",
          stationNo: part?.stationNo || part?.operationNo || "",
        }];

    const groupedByOperation = new Map();
    const requiredOperations = Array.from(
      new Set(
        (machines || [])
          .map((machine) => String(machine.operationNo || machine.operation_no || machine.stationNo || machine.station_no || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    timeline.forEach((item) => {
      const operationKey = String(item.operationNo || item.stationNo || "").trim().toUpperCase() || "__UNKNOWN__";
      const status = normalizeStationResult(item.result || item.status || item.opStatus, item.interlockReason || item.reason, item);
      const existing = groupedByOperation.get(operationKey);
      if (!existing || getOperationStatusPriority(status) > getOperationStatusPriority(existing)) {
        groupedByOperation.set(operationKey, status);
      }
    });

    const statuses = requiredOperations.map((operation) => groupedByOperation.get(operation)).filter(Boolean);

    if (statuses.some((status) => status === "NG")) return "FAILED";
    if (requiredOperations.length > 0 && requiredOperations.every((operation) => groupedByOperation.get(operation) === "OK")) return "PASSED";
    return "IN_PROGRESS";
  }, [getOperationStatusPriority, machines, normalizeStationResult]);

  const getPartFinalState = useCallback((part) => {
    const finalStatus = resolveTimelineFinalStatus(part);
    if (finalStatus === "PASSED") return "passed";
    if (finalStatus === "FAILED") return "failed";
    const raw = String(part?.status || part?.statusLabel || part?.result || part?.industrialResult || "").trim().toUpperCase();
    if (["INTERLOCKED", "BLOCKED", "PLC_COMM_ERROR", "COMM_ERROR", "TIMEOUT", "PLC_TIMEOUT"].includes(raw)) return "blocked";
    return "progress";
  }, [resolveTimelineFinalStatus]);

  const selectedMachineParts = useMemo(() => {
    if (!selectedMachineDetail) return [];
    const machineId = Number(selectedMachineDetail.machine_id || 0);
    return aggregatedPartsList.filter((part) =>
      Number(part.machineId || part.machine_id || 0) === machineId ||
      (Array.isArray(part.stationTimeline) && part.stationTimeline.some((stage) => Number(stage.machineId || 0) === machineId))
    );
  }, [aggregatedPartsList, selectedMachineDetail]);

  const getSelectedMachineStageSnapshot = useCallback((part) => {
    if (!selectedMachineDetail) {
      return {
        state: "progress",
        normalizedStatus: "",
        result: part?.result || part?.status || "-",
        reason: part?.reason || part?.interlockReason || "",
        createdAt: part?.createdAt || null,
      };
    }
    const machineId = Number(selectedMachineDetail.machine_id || 0);
    const timeline = Array.isArray(part?.stationTimeline) ? part.stationTimeline : [];
    const directCandidate = Number(part?.machineId || part?.machine_id || 0) === machineId
      ? {
          machineId,
          status: part?.status || part?.statusLabel || part?.result || part?.industrialResult || "",
          result: part?.result || part?.status || part?.statusLabel || part?.industrialResult || "",
          reason: part?.reason || part?.interlockReason || "",
          interlockReason: part?.interlockReason || part?.reason || "",
          createdAt: part?.createdAt || null,
        }
      : null;
    const matchingStages = [
      ...timeline.filter((stage) => Number(stage?.machineId || 0) === machineId),
      ...(directCandidate ? [directCandidate] : []),
    ];
    const preferredStage = matchingStages.reduce((best, stage) => {
      if (!stage) return best;
      const normalized = normalizeStationResult(stage.result || stage.status || stage.opStatus, stage.interlockReason || stage.reason, stage);
      const nextPriority = getOperationStatusPriority(normalized);
      const bestNormalized = best
        ? normalizeStationResult(best.result || best.status || best.opStatus, best.interlockReason || best.reason, best)
        : "";
      const bestPriority = getOperationStatusPriority(bestNormalized);
      const nextTs = new Date(stage.createdAt || 0).getTime() || 0;
      const bestTs = best ? (new Date(best.createdAt || 0).getTime() || 0) : -1;
      if (!best || nextPriority > bestPriority || (nextPriority === bestPriority && nextTs >= bestTs)) {
        return stage;
      }
      return best;
    }, null);
    const normalizedStatus = normalizeStationResult(
      preferredStage?.result || preferredStage?.status || preferredStage?.opStatus,
      preferredStage?.interlockReason || preferredStage?.reason,
      preferredStage
    );
    return {
      state: normalizedStatus === "OK" ? "passed" : normalizedStatus === "NG" ? "failed" : "progress",
      normalizedStatus,
      result: preferredStage?.result || preferredStage?.status || preferredStage?.opStatus || "-",
      reason: preferredStage?.reason || preferredStage?.interlockReason || "",
      createdAt: preferredStage?.createdAt || part?.createdAt || null,
    };
  }, [getOperationStatusPriority, normalizeStationResult, selectedMachineDetail]);

  const selectedMachineCounts = useMemo(() => {
    return selectedMachineParts.reduce((acc, part) => {
      const state = getSelectedMachineStageSnapshot(part).state;
      acc[state] += 1;
      return acc;
    }, { passed: 0, failed: 0, progress: 0 });
  }, [getSelectedMachineStageSnapshot, selectedMachineParts]);

  const getPartStationStatusMap = useCallback((part) => {
    const map = new Map();
    const machineName = (part.machineName || machineMap.get(Number(part.machineId))?.machineName || "").toString().trim();
    const op = (part.stationNo || part.operationNo || "").toString().trim();
    const directKey = `${machineName}__${op}`;
    const directStatus = normalizeStationResult(part.result || part.status, part.interlockReason || part.reason, part);
    if ((machineName || op) && op !== LEAK_TEST_OPERATION) map.set(directKey, directStatus);

    const timeline = Array.isArray(part.stationTimeline) ? part.stationTimeline : [];
    timeline.forEach((t) => {
      const tMachine = (t.machineName || t.machine_name || machineName || "").toString().trim();
      const tOp = (t.stationNo || t.station_no || t.operationNo || t.operation_no || "").toString().trim();
      const tKey = `${tMachine}__${tOp}`;
      const tStatus = normalizeStationResult(t.result || t.status || t.opStatus, t.interlockReason || t.reason, t);
      if ((tMachine || tOp) && tOp !== LEAK_TEST_OPERATION) map.set(tKey, tStatus);
    });
    if (part?.leakTestReading) {
      const leakMachine = (part.leakTestReading.matchedMachineName || part.leakTestReading.Machine || "").toString().trim();
      const leakKey = `${leakMachine}__${LEAK_TEST_OPERATION}`;
      const leakStatus = getLeakTestStatus(part.leakTestReading);
      if (leakMachine && leakStatus) {
        map.set(leakKey, leakStatus);
      }
    }
    return map;
  }, [machineMap]);

  const getFinalPartStatus = useCallback((part) => {
    return resolveTimelineFinalStatus(part);
  }, [resolveTimelineFinalStatus]);

  const finalPartCounts = useMemo(() => {
    return aggregatedPartsList.reduce((acc, part) => {
      const state = getPartFinalState(part);
      if (state === "passed") acc.passed += 1;
      else if (state === "failed") acc.failed += 1;
      else if (state === "blocked") acc.blocked += 1;
      else acc.progress += 1;
      return acc;
    }, { passed: 0, failed: 0, progress: 0, blocked: 0 });
  }, [aggregatedPartsList, getPartFinalState]);

  const totalOk = finalPartCounts.passed;
  const totalNg = finalPartCounts.failed;
  const totalUnits = totalOk + totalNg;
  const efficiency = totalUnits > 0 ? Math.round((totalOk / totalUnits) * 100) : 0;

  const reportStylePartsTable = useMemo(() => {
    const sourceRows = Array.isArray(reportRows) ? reportRows : [];
    const reportPlcColumns = (() => {
      const sorted = [
        "shot_datetime",
        ...DEFAULT_PLC_CYCLE_COLUMNS.filter((key) => !["machine_name", "shot_number", "shot_date", "shot_time"].includes(key)),
      ];
      const usedLabels = new Map();
      return sorted.map((key) => {
        const baseLabel = key === "shot_datetime" ? "Shot Date & Time" : formatPlcColumnLabel(key);
        const count = usedLabels.get(baseLabel) || 0;
        usedLabels.set(baseLabel, count + 1);
        return { key, label: count === 0 ? baseLabel : `${baseLabel} (${count + 1})` };
      });
    })();
    const machineStationPairs = (machines || [])
      .map((m) => {
        const machineName = String(m.machineName || m.machine_name || "").trim();
        const op = String(m.operationNo || m.operation_no || m.stationNo || m.station_no || "").trim();
        if (!machineName || !op) return null;
        if (String(op).trim().toUpperCase() === LEAK_TEST_OPERATION) {
          return { key: LEAK_TEST_SHARED_KEY, machineName: "Leak Test", op, label: "Leak Test OP150", sharedLeakOperation: true };
        }
        return { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
      })
      .filter(Boolean);
    const machineStationMap = new Map(machineStationPairs.map((item) => [item.key, item]));
    sourceRows.forEach((row) => {
      const machineName = String(row.machineName || "").trim();
      const op = String(row.operationNo || row.stationNo || "").trim();
      if (!machineName || !op) return;
      const pair = String(op).trim().toUpperCase() === LEAK_TEST_OPERATION
        ? { key: LEAK_TEST_SHARED_KEY, machineName: "Leak Test", op, label: "Leak Test OP150", sharedLeakOperation: true }
        : { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
      if (!machineStationMap.has(pair.key)) {
        machineStationMap.set(pair.key, pair);
      }
    });
    const stationPairs = Array.from(machineStationMap.values()).sort((a, b) =>
      a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) || a.machineName.localeCompare(b.machineName)
    );
    const requiredOperations = Array.from(
      new Set(stationPairs.map((item) => String(item.op || "").trim().toUpperCase()).filter(Boolean))
    );
    const grouped = new Map();
    sourceRows.forEach((row, idx) => {
      const partKey = String(row.partId || row.part_id || row.barcode || row.shot_uid || `row_${idx}`).trim();
      const key = partKey || `row_${idx}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    const rows = Array.from(grouped.values()).map((entries, idx) => {
      const first = entries[0] || {};
      const partKey = String(first.partId || first.part_id || first.barcode || first.shot_uid || `row_${idx}`).trim();
      const stationResults = {};
      const stationDisplayValues = {};
      const operationResults = {};
      const plcData = {};
      let leakData = null;
      const firstScanAt = entries.reduce((earliest, row) => {
        const raw = row.firstScanCreatedAt || row.createdAtRaw || row.createdAt || null;
        if (!raw) return earliest;
        if (!earliest) return raw;
        return new Date(raw).getTime() < new Date(earliest).getTime() ? raw : earliest;
      }, null);
      entries.forEach((row) => {
        const stationOp = String(row.operationNo || row.stationNo || "").trim();
        const stationMachine = String(row.machineName || "").trim();
        const stationKey = stationMachine && stationOp ? `${stationMachine}__${stationOp}` : "";
        const rowLeakData = row.leakTestReading && typeof row.leakTestReading === "object" ? row.leakTestReading : null;
        if (!leakData && rowLeakData) leakData = rowLeakData;
        if (stationKey) {
          const normalizedStationResult = normalizeStationResult(
            stationOp === LEAK_TEST_OPERATION ? "" : String(row.industrialResult || row.statusLabel || row.result || "-").toUpperCase(),
            row.reason || row.interlock_reason,
            row
          );
          if (normalizedStationResult) {
            const current = stationResults[stationKey];
            stationResults[stationKey] = getStatusPriority(normalizedStationResult) > getStatusPriority(current)
              ? normalizedStationResult
              : (current || normalizedStationResult);
          }
          if (stationOp && normalizedStationResult) {
            const current = operationResults[stationOp];
            operationResults[stationOp] = getOperationStatusPriority(normalizedStationResult) > getOperationStatusPriority(current)
              ? normalizedStationResult
              : (current || normalizedStationResult);
          }
        }
        const nextPlcData = {
          ...(row.plcReading || {}),
          ...(row.plc_reading || {}),
          ...(row.plcReadings || {}),
          ...(row.plcCycleReadings || {}),
          ...(row.plc_cycle_readings || {}),
        };
        Object.keys(nextPlcData).forEach((key) => {
          if (plcData[key] === undefined || plcData[key] === null || plcData[key] === "" || plcData[key] === "-") {
            plcData[key] = nextPlcData[key];
          }
        });
      });
      if (leakData) {
        const leakStatus = getLeakTestStatus(leakData);
        const leakMachineName = String(leakData.matchedMachineName || leakData.Machine || leakData.machineName || "").trim();
        const currentLeak = stationResults[LEAK_TEST_SHARED_KEY];
        stationResults[LEAK_TEST_SHARED_KEY] = getStatusPriority(leakStatus) > getStatusPriority(currentLeak)
          ? leakStatus
          : (currentLeak || leakStatus);
        stationDisplayValues[LEAK_TEST_SHARED_KEY] = leakMachineName ? `${leakMachineName} ${leakStatus || "-"}`.trim() : (leakStatus || "-");
        const currentOp = operationResults[LEAK_TEST_OPERATION];
        operationResults[LEAK_TEST_OPERATION] = getOperationStatusPriority(leakStatus) > getOperationStatusPriority(currentOp)
          ? leakStatus
          : (currentOp || leakStatus);
      }
      const overallStatus = (() => {
        const vals = requiredOperations.map((operation) => normalizeStationResult(operationResults[operation])).filter(Boolean);
        if (vals.some((value) => value === "NG")) return "FAILED";
        if (requiredOperations.length > 0 && requiredOperations.every((operation) => normalizeStationResult(operationResults[operation]) === "OK")) {
          return "PASSED";
        }
        return "IN_PROGRESS";
      })();
      const shaped = {
        id: partKey || `row_${idx}`,
        barcode: partKey || "—",
        plc_shot_number: plcData.shot_number ?? first.shot_number ?? first.shotNumber ?? extractShotFromPartId(partKey) ?? "-",
        plc_machine_name: plcData.machine_name || first.machineName || "-",
        createdAt: firstScanAt || first.createdAt || null,
        createdAtDisplay: firstScanAt ? new Date(firstScanAt).toLocaleString("en-IN") : "-",
        partName: plcData.part_name || first.partName || first.modelName || first.componentName || "-",
        customerCode: first.customerQrCode || first.customer_qr || "-",
        overallStatus,
        ngReason: (() => {
          const rawReason = first.reason || first.interlock_reason || "";
          const normalizedReason = String(rawReason || "").trim().toUpperCase();
          if (!rawReason || rawReason === "-" || normalizedReason === "RECOVERY_PENDING_AFTER_BACKEND_RESTART") return "";
          return rawReason;
        })(),
      };
      stationPairs.forEach((item) => {
        shaped[`station_${item.key}`] = item.sharedLeakOperation
          ? ({
              machineName: String(leakData?.matchedMachineName || leakData?.Machine || leakData?.machineName || "").trim(),
              status: String(getLeakTestStatus(leakData) || "").trim().toUpperCase() || "-",
              text: stationDisplayValues[item.key] || "-",
            })
          : (normalizeStationResult(stationResults[item.key]) || "-");
      });
      reportPlcColumns.forEach(({ key }) => {
        if (key === "shot_datetime") {
          const y = plcData.shot_year ?? first.shot_year;
          const m = plcData.shot_month ?? first.shot_month;
          const d = plcData.shot_day ?? first.shot_day;
          const hh = plcData.shot_hour ?? first.shot_hour;
          const mm = plcData.shot_minute ?? first.shot_minute;
          const ss = plcData.shot_second ?? first.shot_second;
          shaped[`plc_${key}`] = (y !== undefined && m !== undefined && d !== undefined && hh !== undefined && mm !== undefined && ss !== undefined)
            ? `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
            : `${plcData.shot_date ?? first.shot_date ?? "-"} ${plcData.shot_time ?? first.shot_time ?? ""}`.trim();
        } else if (key === "shot_status") {
          const code = Number(plcData[key] ?? first[key]);
          shaped[`plc_${key}`] = ({ 1: "OK", 3: "WARM UP SHOT", 5: "OFF SHOT" }[code] || (plcData[key] ?? first[key] ?? "-"));
        } else {
          shaped[`plc_${key}`] = plcData[key] ?? first[key] ?? "-";
        }
      });
      LEAK_TEST_COLUMNS.forEach(({ key }) => {
        shaped[`leak_${key}`] = getLeakTestValue(leakData, key);
      });
      return shaped;
    }).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return { stationPairs, plcColumns: reportPlcColumns, rows };
  }, [getOperationStatusPriority, getStatusPriority, machines, normalizeStationResult, reportRows]);

  const isSingleMachineView = Boolean(filters.machineId);

  const plcColumns = useMemo(() => {
    return reportStylePartsTable.plcColumns || [];
  }, [reportStylePartsTable.plcColumns]);

  // Filtered parts for Parts tab
  const filteredParts=useMemo(()=>{
    let p = [...(reportStylePartsTable.rows || [])];
    if(partsSearch){
      const s=partsSearch.toLowerCase();
      p=p.filter(x=>
        String(x.barcode || "").toLowerCase().includes(s) ||
        String(x.customerCode || "").toLowerCase().includes(s) ||
        String(x.partName || "").toLowerCase().includes(s)
      );
    }
    if(partsFilter!=="all"){
      p=p.filter(x=>{
        const finalState = String(x.overallStatus || "").trim().toUpperCase();
        if(partsFilter==="pass")return finalState === "PASSED";
        if(partsFilter==="fail")return finalState === "FAILED" || finalState === "NG";
        if(partsFilter==="progress")return finalState !== "PASSED" && finalState !== "FAILED" && finalState !== "NG";
        return true;
      });
    }
    return p;
  },[partsFilter, partsSearch, reportStylePartsTable.rows]);

  useEffect(() => {
    setPartsPage(1);
  }, [partsSearch, partsFilter, partsPageSize, filters.machineId, filters.lineName, filters.partId, filters.status, filters.shiftCode, timeRange, customDate.from, customDate.to]);

  const pagedParts = useMemo(() => {
    const start = (partsPage - 1) * partsPageSize;
    return filteredParts.slice(start, start + partsPageSize);
  }, [filteredParts, partsPage, partsPageSize]);

  const totalPartsPages = Math.max(1, Math.ceil(filteredParts.length / partsPageSize));

  const stationColumns = useMemo(() => {
    return (reportStylePartsTable.stationPairs || []).map((item) => ({ key: item.key, label: item.label, sharedLeakOperation: item.sharedLeakOperation }));
  }, [reportStylePartsTable.stationPairs]);

  const getPlcValue = (part, key) => {
    if (part?.plcReading && typeof part.plcReading === "object" && key in part.plcReading) {
      return part.plcReading[key];
    }
    if (part?.plcReadings && typeof part.plcReadings === "object" && key in part.plcReadings) {
      return part.plcReadings[key];
    }
    if (part?.leakTestReading && typeof part.leakTestReading === "object" && key in part.leakTestReading) {
      return part.leakTestReading[key];
    }
    if (key === "shot_time") {
      const hh = part?.plcReading?.shot_hour ?? part?.plcReadings?.shot_hour ?? part?.leakTestReading?.shot_hour;
      const mm = part?.plcReading?.shot_minute ?? part?.plcReadings?.shot_minute ?? part?.leakTestReading?.shot_minute;
      const ss = part?.plcReading?.shot_second ?? part?.plcReadings?.shot_second ?? part?.leakTestReading?.shot_second;
      if ([hh, mm, ss].every((v) => v !== null && v !== undefined && v !== "")) {
        return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      }
    }
    if (key === "shot_date") {
      const y = part?.plcReading?.shot_year ?? part?.plcReadings?.shot_year ?? part?.leakTestReading?.shot_year;
      const m = part?.plcReading?.shot_month ?? part?.plcReadings?.shot_month ?? part?.leakTestReading?.shot_month;
      const d = part?.plcReading?.shot_day ?? part?.plcReadings?.shot_day ?? part?.leakTestReading?.shot_day;
      if ([y, m, d].every((v) => v !== null && v !== undefined && v !== "")) {
        return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
    if (key === "shot_datetime") {
      const shotDate = getPlcValue(part, "shot_date");
      const shotTime = getPlcValue(part, "shot_time");
      const dateText = shotDate && shotDate !== "-" ? String(shotDate) : "";
      const timeText = shotTime && shotTime !== "-" ? String(shotTime) : "";
      return [dateText, timeText].filter(Boolean).join(" ") || "-";
    }
    return part?.[key];
  };

  const handleFullExcel = async () => {
    try {
      const blob = await dashboardApi.exportFullReport(query);
      downloadBlob(
        new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Production_Report_${dateStr()}.xlsx`
      );
    } catch {
      setError(t("production.fullReportExportFailed", "Full report export failed."));
    }
  };

  const handlePartsExcel = async () => {
    try {
      const blob = await dashboardApi.exportPartsReport(query);
      downloadBlob(
        new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Production_Parts_${dateStr()}.xlsx`
      );
    } catch {
      setError(t("production.partsReportExportFailed", "Parts report export failed."));
    }
  };

  const handleDownloadReport = handleFullExcel;

  const axStyle={fontSize:11,fill:C.txt("muted"),fontFamily:"monospace"};

  const TABS=[
    {key:"overview",  label:t("production.overview", "Overview"),      icon:LayoutDashboard},
    {key:"hourly",    label:t("production.hourlyTrend", "Hourly Trend"),  icon:BarChart3      },
    {key:"machine",   label:t("production.byMachine", "By Machine"),    icon:Cpu            },
    {key:"shift",     label:t("production.byShift", "By Shift"),      icon:Zap            },
    {key:"parts",     label:`${t("production.partsList", "Parts List")}${reportStylePartsTable.rows.length?` (${reportStylePartsTable.rows.length})`:""}`, icon:List},
  ];
  const shiftCards = [
    {key:"SHIFT_A",label:t("production.shiftAMorning", "Shift A — Morning"),colorFn:C.steel,icon:Zap},
    {key:"SHIFT_B",label:t("production.shiftBAfternoon", "Shift B — Afternoon"),colorFn:C.amber,icon:Activity},
    {key:"SHIFT_C",label:t("production.shiftCNight", "Shift C — Night"),colorFn:C.idle,icon:Clock},
  ];
  const machineTableHeaders = ["#",t("production.machineName", "Machine Name"),t("production.total", "Total"),t("production.pass", "Pass"),t("production.fail", "Fail"),t("production.inProgress", "In Progress"),t("production.target", "Target"),t("production.achieved", "Achieved"),"OEE","OA",t("dashboard.downtime", "Downtime"),t("production.view", "View")];
  const shiftTableHeaders = [t("production.shift", "Shift"),t("production.total", "Total"),t("production.passOk", "Pass (OK)"),t("production.failNg", "Fail (NG)"),t("production.qualityRate", "Quality Rate"),t("production.progress", "Progress")];
  const partsTableHeaders = [t("production.shotNumber", "Shot Number"),t("production.partSerialNo", "Part Serial No."),t("production.customerQrCode", "Customer QR Code"),t("production.partName", "Part Name"),t("production.machineName", "Machine Name"),t("production.scannedDateTime", "Scanned Date & Time"),t("production.finalStatus", "Final Status"),t("production.reasonRemark", "Reason / Remark")];
  const machineDetailHeaders = ["#",t("production.partId", "Part ID"),t("production.status", "Status"),t("production.result", "Result"),t("production.reason", "Reason"),t("production.scannedAt", "Scanned At")];

  // -- RENDER -------------------------------------------------------------
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16,paddingBottom:32,animation:"pcFadeIn .3s ease"}}>

      {/* -- PAGE HEADER ------------------------------------------------ */}
      <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
        borderRadius:16,overflow:"hidden",boxShadow:SH}}>
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>
        <div style={{padding:"14px 20px"}}>
          <div style={{display:"flex",alignItems:"center",
            justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:13}}>
              <div style={{width:44,height:44,borderRadius:12,flexShrink:0,
                background:`linear-gradient(135deg,${C.navy()},${C.steel(0.85)})`,
                display:"flex",alignItems:"center",justifyContent:"center",
                boxShadow:`0 4px 12px ${C.navy(0.38)}`}}>
                <BarChart3 size={20} color={C.linen()}/>
              </div>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap"}}>
                  <h1 style={{fontSize:17,fontWeight:800,color:C.txt("pri"),letterSpacing:"-0.02em"}}>
                    {t("production.analyticsTitle", "Production Analytics")}
                  </h1>
                  <span style={{fontSize:10,fontWeight:700,color:C.amber(),
                    background:C.amber(0.1),padding:"2px 9px",borderRadius:99,
                    border:`1px solid ${C.amber(0.3)}`}}>{t("production.live", "LIVE")}</span>
                </div>
                <p style={{fontSize:11,color:C.txt("muted"),marginTop:3}}>
                  {timeLabel} · {fmtNow()} · {lineContextLabel}
                </p>
              </div>
            </div>

            {/* Controls row */}
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              {["daily","weekly","monthly"].map(k=>(
                <button key={k} onClick={()=>{setTimeRange(k);setCustomDate({from:"",to:""}); }}
                  style={{height:32,padding:"0 11px",borderRadius:7,fontSize:11,fontWeight:700,
                    cursor:"pointer",transition:"all .12s",
                    background:timeRange===k&&!customDate.from?C.navy():"transparent",
                    border:`1px solid ${timeRange===k&&!customDate.from?C.navy(0.5):C.bdr()}`,
                    color:timeRange===k&&!customDate.from?C.linen():C.txt("muted")}}>
                  {k==="daily"?t("production.today", "Today"):k==="weekly"?t("production.last7Days", "7 Days"):t("production.last30Days", "30 Days")}
                </button>
              ))}
              <div style={{display:"flex",alignItems:"center",gap:5,padding:"0 9px",height:32,
                background:C.bg("surf"),border:`1px solid ${C.bdr()}`,borderRadius:7}}>
                <Calendar size={11} color={C.txt("muted")}/>
                <input type="datetime-local" value={customDate.from||""}
                  onChange={e=>{setCustomDate(p=>({...p,from:e.target.value}));setTimeRange("custom");}}
                  style={{height:22,background:"transparent",border:"none",fontSize:11,color:C.txt("pri"),outline:"none",cursor:"pointer"}}/>
                <span style={{fontSize:11,color:C.txt("muted")}}>–</span>
                <input type="datetime-local" value={customDate.to||""}
                  onChange={e=>{setCustomDate(p=>({...p,to:e.target.value}));setTimeRange("custom");}}
                  style={{height:22,background:"transparent",border:"none",fontSize:11,color:C.txt("pri"),outline:"none",cursor:"pointer"}}/>
              </div>
              <button onClick={loadData} disabled={loading}
                style={{height:32,padding:"0 12px",borderRadius:7,fontSize:12,fontWeight:700,
                  cursor:"pointer",background:"transparent",border:`1px solid ${C.bdr()}`,
                  color:C.txt("sec"),opacity:loading?0.5:1,
                  display:"inline-flex",alignItems:"center",gap:5,transition:"all .15s"}}>
                <RefreshCw size={12} style={{animation:loading?"pcSpin .9s linear infinite":"none"}}/>
                {loading?t("common.loading", "Loading..."):t("production.refresh", "Refresh")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* -- DOWNLOAD BAR — TOP --------------------------------------- */}
      <div style={{
        background:C.bg("card"),
        border:`1px solid ${C.bdr()}`,
        borderRadius:12,
        padding:"12px 14px",
        boxShadow:SH,
        display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",
        gap:8,
      }}>
        <PlantLineSelector
          value={filters}
          onChange={(scope)=>setFilters((prev)=>({...prev,...scope,machineId:""}))}
          includeAll
          compact
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          inputClassName="h-[34px] rounded-lg border border-border bg-bg-dark px-3 text-xs font-bold text-text-main outline-none"
        />
        <select
          value={filters.machineId}
          onChange={(e)=>setFilters((prev)=>({...prev,machineId:e.target.value}))}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        >
          <option value="">{t("production.allMachines", "All Machines")}</option>
          {machines
            .filter((m)=>!filters.plantId || String(m.plantId || "") === String(filters.plantId))
            .filter((m)=>!filters.lineId || String(m.lineId || "") === String(filters.lineId))
            .filter((m)=>!filters.lineName || String(m.lineName || "").trim() === filters.lineName)
            .map((m)=>(
              <option key={m.id} value={m.id}>{m.machineName}</option>
            ))}
        </select>
        <input
          value={filters.partId}
          onChange={(e)=>setFilters((prev)=>({...prev,partId:e.target.value}))}
          placeholder={t("reports.partId", "Part ID")}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        />
        <select
          value={filters.status}
          onChange={(e)=>setFilters((prev)=>({...prev,status:e.target.value}))}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        >
          <option value="">{t("reports.allStatus", "All Status")}</option>
          <option value="OK">{t("reports.passed", "PASSED")}</option>
          <option value="NG">{t("reports.failed", "FAILED")}</option>
        </select>
        <select
          value={filters.shiftCode}
          onChange={(e)=>setFilters((prev)=>({...prev,shiftCode:e.target.value}))}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        >
          <option value="">{t("production.allShifts", "All Shifts")}</option>
          {(report.availableShifts || []).map((shift)=>(
            <option key={shift.shiftCode} value={shift.shiftCode}>{shift.shiftName || shift.shiftCode}</option>
          ))}
        </select>
        <button
          onClick={()=>setFilters({plantId:"",lineId:"",machineId:"",lineName:"",partId:"",status:"",shiftCode:""})}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.ng(0.3)}`,background:C.ng(0.08),color:C.ng(),fontSize:12,fontWeight:700,cursor:"pointer"}}
        >
          {t("reports.clear", "Clear")}
        </button>
      </div>

      <div style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        flexWrap:"wrap",gap:10,padding:"13px 18px",borderRadius:13,
        background:`linear-gradient(135deg,${C.navy(0.06)},${C.steel(0.04)})`,
        border:`1px solid ${C.navy(0.18)}`,boxShadow:SH,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:9,
            background:`linear-gradient(135deg,${C.amber()},${C.amber(0.8)})`,
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:`0 2px 8px ${C.amber(0.3)}`}}>
            <Download size={16} color={C.navy()}/>
          </div>
          <div>
            <p style={{fontSize:13,fontWeight:800,color:C.txt("pri")}}>{t("production.exportFilters", "Export & Filters")}</p>
            <p style={{fontSize:10,color:C.txt("muted")}}>
              {timeLabel} · {totalUnits} units · {efficiency}% quality rate
            </p>
          </div>
        </div>
        <div style={{display:"flex",gap:9,flexWrap:"wrap",alignItems:"center"}}>
          <span
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              fontSize: 12,
              fontWeight: 800,
              color: C.navy(),
              border: `1px solid ${C.navy(0.25)}`,
              background: `linear-gradient(135deg, ${C.navy(0.12)}, ${C.amber(0.12)})`,
            }}
          >
            {t("production.filtersSelected", "Filters Selected")}: {selectedFilterCount}
          </span>
          <button onClick={handleDownloadReport}
            style={{display:"inline-flex",alignItems:"center",gap:6,height:36,padding:"0 14px",
              borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
              background:C.steel(0.1),border:`1px solid ${C.steel(0.3)}`,color:C.steel(),transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.2)}
            onMouseLeave={e=>e.currentTarget.style.background=C.steel(0.1)}>
            <Download size={13}/> {t("reports.downloadReport", "Download Report")}
          </button>
        </div>
      </div>

      {error&&(
        <div style={{display:"flex",alignItems:"center",gap:9,padding:"10px 14px",
          borderRadius:9,background:C.ng(0.07),border:`1px solid ${C.ng(0.25)}`,
          color:C.ng(),fontSize:12,fontWeight:600}}>
          <AlertCircle size={14} style={{flexShrink:0}}/>{error}
        </div>
      )}

      {/* -- KPI ROW ---------------------------------------------------- */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:11}}>
        <KpiCard label={t("production.passOk", "Pass (OK)")}      value={totalOk}   sub={t("production.qualityApproved", "Quality approved")} icon={CheckCircle2}
          color={C.ok()} bgC={C.ok(0.07)} bdC={C.ok(0.22)}/>
        <KpiCard label={t("production.failNg", "Fail (NG)")}      value={totalNg}   sub={t("production.failedQualityCheck", "Failed quality check")} icon={XCircle}
          color={C.ng()} bgC={C.ng(0.07)} bdC={C.ng(0.22)}/>
        <KpiCard label={t("production.qualityRate", "Quality Rate")}   value={`${efficiency}%`} sub={t("production.passVsTotal", "Pass / Total")} icon={TrendingUp}
          color={efficiency>=85?C.ok():efficiency>=60?C.wip():C.ng()}
          bgC={efficiency>=85?C.ok(0.07):efficiency>=60?C.wip(0.07):C.ng(0.07)}
          bdC={efficiency>=85?C.ok(0.22):efficiency>=60?C.wip(0.22):C.ng(0.22)}/>
        <KpiCard label={t("production.inProgress", "In Progress")}    value={finalPartCounts.progress||0} sub={t("production.currentlyProcessing", "Currently processing")} icon={Activity}
          color={C.steel()} bgC={C.steel(0.07)} bdC={C.steel(0.22)}/>
      </div>

      {/* -- TABS ------------------------------------------------------- */}
      <div style={{display:"flex",gap:4,padding:4,background:C.bg("card"),
        border:`1px solid ${C.bdr()}`,borderRadius:12,
        overflowX:"auto",flexShrink:0}}>
        {TABS.map(tab=>{
          const active=activeTab===tab.key;
          const TI=tab.icon;
          return(
            <button key={tab.key} onClick={()=>setActiveTab(tab.key)}
              style={{display:"inline-flex",alignItems:"center",gap:6,
                height:34,padding:"0 14px",borderRadius:8,
                fontSize:12,fontWeight:700,cursor:"pointer",
                whiteSpace:"nowrap",border:"none",
                background:active?C.navy():"transparent",
                color:active?C.linen():C.txt("muted"),
                boxShadow:active?`0 2px 8px ${C.navy(0.3)}`:"none",
                transition:"all .15s"}}>
              <TI size={13}/>{tab.label}
            </button>
          );
        })}
      </div>

      {/* -- TAB: OVERVIEW ---------------------------------------------- */}
      {activeTab==="overview"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14,alignItems:"start",animation:"pcFadeIn .2s ease"}}>
          {/* Quality donut + parts status */}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Card title={t("production.qualitySummary", "Quality Summary")} subtitle={t("production.passVsFailRatio", "Pass vs Fail ratio")} icon={PieIcon} accent={C.amber()}>
              <div style={{display:"flex",alignItems:"center",gap:24,padding:"8px 0",flexWrap:"wrap"}}>
                {/* Donut */}
                <div style={{position:"relative",width:160,height:160,flexShrink:0,minWidth:160,minHeight:160}}>
                  <RePieChart width={160} height={160}>
                    <Pie data={qualityPie} cx="50%" cy="50%" innerRadius={52} outerRadius={72}
                      paddingAngle={3} dataKey="value" strokeWidth={0}>
                      <Cell fill={C.ok()}/><Cell fill={C.ng()}/>
                    </Pie>
                    <Tooltip content={<TipBox/>}/>
                  </RePieChart>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
                    alignItems:"center",justifyContent:"center"}}>
                    <p style={{fontSize:22,fontWeight:900,lineHeight:1,
                      color:efficiency>=85?C.ok():efficiency>=60?C.wip():C.ng(),
                      fontFamily:"'DM Mono',monospace"}}>{efficiency}%</p>
                    <p style={{fontSize:9,color:C.txt("muted"),marginTop:3,
                      textTransform:"uppercase",letterSpacing:"0.07em"}}>{t("production.quality", "Quality")}</p>
                  </div>
                </div>
                {/* Stats */}
                <div style={{flex:1,minWidth:220,display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    {l:t("production.passOk", "Pass (OK)"),  v:totalOk,  c:C.ok(),   bg:C.ok(0.08),  bd:C.ok(0.2)},
                    {l:t("production.failNg", "Fail (NG)"),  v:totalNg,  c:C.ng(),   bg:C.ng(0.08),  bd:C.ng(0.2)},
                  ].map(s=>(
                    <div key={s.l} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                      padding:"11px 14px",borderRadius:9,background:s.bg,border:`1px solid ${s.bd}`}}>
                      <span style={{fontSize:12,color:C.txt("pri"),fontWeight:600}}>{s.l}</span>
                      <span style={{fontSize:22,fontWeight:900,color:s.c,
                        fontFamily:"'DM Mono',monospace"}}>{s.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Parts status */}
            <Card title={t("production.partsStatus", "Parts Status")} subtitle={t("production.breakdown", "Breakdown")} icon={Settings2} accent={C.navy()}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
                {[
                  {l:t("production.completed", "Completed"),  v:summary.quality?.ok||0,       c:C.ok()  },
                  {l:t("production.inProgress", "In Progress"),v:summary.parts?.inProgress||0, c:C.steel()},
                  {l:t("production.rework", "Rework"),     v:summary.parts?.rework||0,     c:C.ng()  },
                ].map(s=>(
                  <div key={s.l} style={{padding:"10px 13px",borderRadius:9,
                    background:C.bg("surf"),border:`1px solid ${C.bdr()}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                      <div style={{width:8,height:8,borderRadius:2,background:s.c,flexShrink:0}}/>
                      <span style={{fontSize:10,fontWeight:700,color:C.txt("muted"),
                        textTransform:"uppercase",letterSpacing:"0.07em"}}>{s.l}</span>
                    </div>
                    <p style={{fontSize:20,fontWeight:800,color:s.c,
                      fontFamily:"'DM Mono',monospace",lineHeight:1}}>{s.v}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Shift cards */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
              letterSpacing:"0.1em",color:C.txt("muted")}}>{t("production.shiftPerformance", "Shift Performance")}</p>
            {shiftCards.map(s=>(
              <ShiftCard key={s.key} label={s.label}
                row={shiftRowsNormalized?.[s.key]}
                colorFn={s.colorFn} icon={s.icon} t={t}/>
            ))}
          </div>
        </div>
      )}

      {/* -- TAB: HOURLY ----------------------------------------------- */}
      {activeTab==="hourly"&&(
        <div style={{animation:"pcFadeIn .2s ease"}}>
          <Card title={t("production.hourlyProduction", "Hourly Production")} subtitle={t("production.passVsFailPerHour", "Pass vs Fail per hour")} icon={BarChart3} accent={C.steel()}
            right={
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{display:"flex",gap:8,marginRight:4}}>
                  {[{c:C.ok(),l:t("production.pass", "Pass")},{c:C.ng(),l:t("production.fail", "Fail")}].map(s=>(
                    <div key={s.l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.txt("muted")}}>
                      <div style={{width:10,height:10,borderRadius:3,background:s.c}}/>{s.l}
                    </div>
                  ))}
                </div>
                {[{k:"bar",label:t("production.bar", "Bar")},{k:"line",label:t("production.line", "Line")},{k:"area",label:t("production.area", "Area")}].map(type=>(
                  <button key={type.k} onClick={()=>setChartType(type.k)}
                    style={{height:28,padding:"0 10px",borderRadius:6,fontSize:11,cursor:"pointer",
                      background:chartType===type.k?C.navy():"transparent",
                      border:`1px solid ${chartType===type.k?C.navy(0.5):C.bdr()}`,
                      color:chartType===type.k?C.linen():C.txt("muted"),fontWeight:700,transition:"all .12s"}}>
                    {type.label}
                  </button>
                ))}
              </div>
            }>
            {productionData.length===0?(
              <div style={{height:350,display:"flex",alignItems:"center",justifyContent:"center",
                flexDirection:"column",gap:8,color:C.txt("muted"),fontSize:12}}>
                <BarChart3 size={28} color={C.txt("muted")}/>{t("production.noHourlyData", "No hourly data for this period.")}
              </div>
            ):(
              <SafeChart height={350}>
                {({ width, height }) => (
                <Fragment>
                  {chartType==="area"?(
                    <AreaChart width={width} height={height} data={productionData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <defs>
                        <linearGradient id="gOk" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.ok()} stopOpacity={0.22}/><stop offset="95%" stopColor={C.ok()} stopOpacity={0.02}/>
                        </linearGradient>
                        <linearGradient id="gNg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.ng()} stopOpacity={0.18}/><stop offset="95%" stopColor={C.ng()} stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.bdr(0.1)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey="hour" tick={axStyle} axisLine={false} tickLine={false}/>
                      <YAxis tick={axStyle} axisLine={false} tickLine={false}/>
                      <Tooltip content={<TipBox/>}/>
                      <Area type="monotone" dataKey="Pass" name={t("production.pass", "Pass")} stroke={C.ok()} strokeWidth={2.5} fill="url(#gOk)" dot={false}/>
                      <Area type="monotone" dataKey="Fail" name={t("production.fail", "Fail")} stroke={C.ng()} strokeWidth={2} fill="url(#gNg)" dot={false}/>
                    </AreaChart>
                  ):chartType==="line"?(
                    <ReLineChart width={width} height={height} data={productionData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.1)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey="hour" tick={axStyle} axisLine={false} tickLine={false}/>
                      <YAxis tick={axStyle} axisLine={false} tickLine={false}/>
                      <Tooltip content={<TipBox/>}/>
                      <Line type="monotone" dataKey="Pass" name={t("production.pass", "Pass")} stroke={C.ok()} strokeWidth={2.5} dot={false} activeDot={{r:4,fill:C.ok()}}/>
                      <Line type="monotone" dataKey="Fail" name={t("production.fail", "Fail")} stroke={C.ng()} strokeWidth={2} dot={false} strokeDasharray="5 3" activeDot={{r:4,fill:C.ng()}}/>
                      <Line type="monotone" dataKey="Total" name={t("production.total", "Total")} stroke={C.steel()} strokeWidth={1.5} dot={false} strokeDasharray="2 5"/>
                    </ReLineChart>
                  ):(
                    <BarChart width={width} height={height} data={productionData} barGap={3} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.1)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey="hour" tick={axStyle} axisLine={false} tickLine={false}/>
                      <YAxis tick={axStyle} axisLine={false} tickLine={false}/>
                      <Tooltip content={<TipBox/>}/>
                      <Bar dataKey="Pass" name={t("production.pass", "Pass")} fill={C.ok()} radius={[4,4,0,0]} maxBarSize={22}/>
                      <Bar dataKey="Fail" name={t("production.fail", "Fail")} fill={C.ng()} radius={[4,4,0,0]} maxBarSize={22}/>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11,paddingTop:8,color:C.txt("muted")}}/>
                    </BarChart>
                  )}
                </Fragment>
                )}
              </SafeChart>
            )}
          </Card>
        </div>
      )}

      {/* -- TAB: BY MACHINE ------------------------------------------- */}
      {activeTab==="machine"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14,animation:"pcFadeIn .2s ease"}}>
          {/* Chart */}
          <Card title={t("production.machineWiseProduction", "Machine-wise Production")} subtitle={t("production.passVsFailPerMachine", "Pass vs Fail per machine")} icon={Cpu} accent={C.navy()}>
            {machineBarData.length===0?(
              <div style={{height:260,display:"flex",alignItems:"center",justifyContent:"center",
                flexDirection:"column",gap:8,color:C.txt("muted"),fontSize:12}}>
                <Cpu size={26} color={C.txt("muted")}/>{t("production.noMachineData", "No machine data.")}
              </div>
            ):(
              <SafeChart height={260}>
                {({ width, height }) => (
                  <BarChart width={width} height={height} data={machineBarData} barGap={3} margin={{top:4,right:8,bottom:0,left:-10}}>
                    <CartesianGrid stroke={C.bdr(0.1)} strokeDasharray="3 4" vertical={false}/>
                    <XAxis dataKey="name" tick={{...axStyle,fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis tick={axStyle} axisLine={false} tickLine={false}/>
                    <Tooltip content={<TipBox/>}/>
                    <Bar dataKey="Pass" name={t("production.pass", "Pass")} fill={C.ok()} radius={[4,4,0,0]} maxBarSize={22}/>
                    <Bar dataKey="Fail" name={t("production.fail", "Fail")} fill={C.ng()} radius={[4,4,0,0]} maxBarSize={22}/>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11,paddingTop:8,color:C.txt("muted")}}/>
                  </BarChart>
                )}
              </SafeChart>
            )}
          </Card>
          {/* Machine table */}
          <Card noPad title={t("production.machinePerformanceSummary", "Machine Performance Summary")} subtitle={t("production.qualityRatePerMachine", "Quality rate per machine")} icon={Cpu} accent={C.steel()}
            right={<div style={{display:"flex",gap:8}}><Bdg v="ok" l="=85%"/><Bdg v="wip" l="60-84%"/><Bdg v="ng" l="<60%"/></div>}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                    {machineTableHeaders.map(h=>(
                      <th key={h} style={{padding:"9px 13px",textAlign:"left",fontSize:9,fontWeight:800,
                        textTransform:"uppercase",letterSpacing:"0.09em",color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {machinePerformanceRows.length===0?(
                    <tr><td colSpan={12} style={{padding:"36px",textAlign:"center",color:C.txt("muted"),fontSize:12}}>{t("production.noData", "No data available")}</td></tr>
                  ):machinePerformanceRows.map((row,i)=>{
                    const producedUnits=Number(row.produced ?? ((Number(row.ok||0))+(Number(row.ng||0))));
                    const eff=producedUnits>0?Math.round(Number(row.ok||0)/producedUnits*100):0;
                    const name = String(row.machineName || `Machine ${row.machine_id}`);
                    const v=eff>=85?"ok":eff>=60?"wip":"ng";
                    const vc=v==="ok"?C.ok():v==="wip"?C.wip():C.ng();
                    return(
                      <tr key={i} style={{borderBottom:`1px solid ${C.bdr()}`,
                        background:i%2===1?C.bg("surf"):"transparent",transition:"background .1s"}}
                        onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.04)}
                        onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.bg("surf"):"transparent"}>
                        <td style={{padding:"10px 13px",color:C.txt("muted"),fontSize:11}}>{i+1}</td>
                        <td style={{padding:"10px 13px",fontWeight:700,color:C.txt("pri")}}>{name}</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.txt("pri"),textAlign:"center"}}>{producedUnits}</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.ok(),textAlign:"center"}}>{row.ok||0}</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.ng(),textAlign:"center"}}>{row.ng||0}</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.wip(),textAlign:"center"}}>{row.inProgress||0}</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.txt("muted"),textAlign:"center"}}>{row.target||0}</td>
                        <td style={{padding:"10px 13px",textAlign:"center"}}>
                          <span style={{fontSize:13,fontWeight:800,color:vc,fontFamily:"'DM Mono',monospace"}}>{Number(row.achievementPct || 0)}%</span>
                        </td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.steel(),textAlign:"center"}}>{Math.round(Number(row.oee || 0))}%</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.amber(),textAlign:"center"}}>{Math.round(Number(row.oa || 0))}%</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.txt("muted"),textAlign:"center"}}>{Math.round(Number(row.downtimeMinutes || 0))}m</td>
                        <td style={{padding:"10px 13px",textAlign:"center"}}>
                          <button
                            type="button"
                            onClick={() => setSelectedMachineDetail(row)}
                            title={t("production.viewMachineData", "View machine data")}
                            style={{width:30,height:30,borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.steel(),display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}
                          >
                            <Eye size={14}/>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* -- TAB: BY SHIFT --------------------------------------------- */}
      {activeTab==="shift"&&(
        <div style={{animation:"pcFadeIn .2s ease"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:14}}>
            {shiftCards.map(s=>(
              <ShiftCard key={s.key} label={s.label}
                row={shiftRowsNormalized?.[s.key]}
                colorFn={s.colorFn} icon={s.icon} t={t}/>
            ))}
          </div>
          {/* Shift table */}
          <div style={{marginTop:14}}>
            <Card noPad title={`${t("production.shiftPerformance", "Shift Performance")} ${t("production.details", "Details")}`} subtitle={t("production.completeBreakdown", "Complete breakdown")} icon={Activity} accent={C.amber()}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                    {shiftTableHeaders.map(h=>(
                      <th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:9,fontWeight:800,
                        textTransform:"uppercase",letterSpacing:"0.09em",color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(shiftRowsNormalized||{}).map(([sh,row],i)=>{
                    const t=Number(row.total||0),ok=Number(row.ok||0),ng=t-ok,eff=t>0?Math.round(ok/t*100):0;
                    const v=eff>=85?"ok":eff>=60?"wip":"ng";
                    const vc=v==="ok"?C.ok():v==="wip"?C.wip():C.ng();
                    return(
                      <tr key={sh} style={{borderBottom:`1px solid ${C.bdr()}`,
                        background:i%2===1?C.bg("surf"):"transparent"}}>
                        <td style={{padding:"11px 16px",fontWeight:800,color:C.txt("pri")}}>{sh.replace("_"," ")}</td>
                        <td style={{padding:"11px 16px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.txt("pri"),textAlign:"center"}}>{t}</td>
                        <td style={{padding:"11px 16px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.ok(),textAlign:"center"}}>{ok}</td>
                        <td style={{padding:"11px 16px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.ng(),textAlign:"center"}}>{ng}</td>
                        <td style={{padding:"11px 16px",textAlign:"center"}}>
                          <span style={{fontSize:14,fontWeight:800,color:vc,fontFamily:"'DM Mono',monospace"}}>{eff}%</span>
                        </td>
                        <td style={{padding:"11px 16px",minWidth:120}}>
                          <div style={{height:6,borderRadius:99,background:C.bdr(0.14),overflow:"hidden",display:"flex"}}>
                            <div style={{background:C.ok(),height:"100%",width:`${t>0?ok/t*100:0}%`,transition:"width .5s"}}/>
                            <div style={{background:C.ng(),height:"100%",width:`${t>0?ng/t*100:0}%`,transition:"width .5s"}}/>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}

      {/* -- TAB: PARTS LIST ------------------------------------------- */}
      {activeTab==="parts"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12,animation:"pcFadeIn .2s ease"}}>

          {/* Filter + search bar */}
          <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
            borderRadius:12,padding:"12px 16px",boxShadow:SH,
            display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            {/* Search */}
            <div style={{position:"relative",flex:"1 1 200px",minWidth:160}}>
              <input value={partsSearch} onChange={e=>setPartsSearch(e.target.value)}
                placeholder={t("production.searchPartSerialOrBatch", "Search part serial or batch...")}
                style={{width:"100%",height:36,paddingLeft:14,paddingRight:12,
                  background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,color:C.txt("pri"),outline:"none",
                  boxSizing:"border-box",fontFamily:"'DM Mono',monospace"}}/>
            </div>
            {/* Filter buttons */}
            <div style={{display:"flex",gap:5,padding:3,background:C.bg("surf"),
              border:`1px solid ${C.bdr()}`,borderRadius:8}}>
              {[{k:"all",l:t("common.current", "All").replace("Current","All")},
                {k:"pass",l:t("dashboard.pass", "Pass")},
                {k:"fail",l:t("dashboard.fail", "Fail")},
                {k:"progress",l:t("production.inProgress", "In Progress")}].map(f=>(
                <button key={f.k} onClick={()=>setPartsFilter(f.k)}
                  style={{height:28,padding:"0 11px",borderRadius:5,fontSize:11,fontWeight:700,
                    cursor:"pointer",border:"none",transition:"all .12s",
                    background:partsFilter===f.k?C.navy():"transparent",
                    color:partsFilter===f.k?C.linen():C.txt("muted")}}>
                  {f.l}
                </button>
              ))}
            </div>
            {/* Stats */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto",flexWrap:"wrap"}}>
              <span style={{fontSize:11,color:C.txt("muted")}}>
                Showing <strong style={{color:C.txt("pri")}}>{filteredParts.length}</strong> of <strong style={{color:C.txt("pri")}}>{reportStylePartsTable.rows.length}</strong> parts
              </span>
            </div>
          </div>

          {reportStylePartsTable.rows.length===0?(
            <div style={{padding:"56px 24px",textAlign:"center",
              background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14}}>
              <List size={32} color={C.txt("muted")} style={{margin:"0 auto 14px"}}/>
              <p style={{fontSize:14,fontWeight:600,color:C.txt("sec"),marginBottom:6}}>
                {t("production.noPartsDataAvailable", "No parts data available")}
              </p>
              <p style={{fontSize:12,color:C.txt("muted")}}>
                {t("production.partsListPopulated", "Parts list is populated from the production scan history for this period.")}
              </p>
            </div>
          ):(
            <>
            <Card noPad title={`${t("production.productionPartsList", "Production Parts List")} — ${filteredParts.length} ${t("production.records", "records")}`}
              subtitle={t("production.allScannedPartsThisPeriod", "All scanned parts this period")} icon={List} accent={C.navy()}>
              <div className="pc-thin-scroll" style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,fontFamily:"inherit"}}>
                  <thead>
                    <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                      {[
                        ...partsTableHeaders.slice(0, 6),
                        ...stationColumns.map((c)=>c.label),
                        partsTableHeaders[6],
                        ...plcColumns.map((c) => c.label),
                        ...LEAK_TEST_COLUMNS.map((c) => c.label),
                        partsTableHeaders[7]
                      ].map((h, idx)=>(
                        <th key={`${h}-${idx}`} style={{padding:"9px 13px",textAlign:"center",fontSize:10,
                          fontWeight:900,textTransform:"uppercase",letterSpacing:"0.06em",
                          color:"#111827",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedParts.map((p,i)=>{
                      const finalStatus = String(p.overallStatus || "").trim().toUpperCase();
                      const isNg = finalStatus === "FAILED" || finalStatus === "NG";
                      const finalBadge =
                        finalStatus === "PASSED"
                          ? { v: "ok", l: t("production.passed", "Passed") }
                          : finalStatus === "FAILED" || finalStatus === "NG"
                            ? { v: "ng", l: t("production.failed", "Failed") }
                            : { v: "wip", l: t("production.inProgress", "In Progress") };
                      return(
                        <tr key={i} style={{borderBottom:`1px solid ${C.bdr()}`,
                          background:i%2===1?C.bg("surf"):"transparent",transition:"background .1s"}}
                          onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.04)}
                          onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.bg("surf"):"transparent"}>
                          <td style={{padding:"9px 13px",fontSize:11,color:"#111827",fontWeight:600,whiteSpace:"nowrap"}}>
                            {renderCellValue(p.plc_shot_number)}
                          </td>
                          <td style={{padding:"9px 13px"}}>
                            <span style={{fontFamily:"inherit",fontSize:11,
                              fontWeight:700,color:"#111827"}}>{p.barcode||"—"}</span>
                          </td>
                          <td style={{padding:"9px 13px",fontSize:11,color:C.txt("sec")}}>
                            {p.customerCode || "—"}
                          </td>
                          <td style={{padding:"9px 13px",fontSize:11,color:"#111827",fontWeight:600,whiteSpace:"nowrap"}}>
                            {p.partName || "—"}
                          </td>
                          <td style={{padding:"9px 13px",fontSize:11,color:"#111827",fontWeight:600,whiteSpace:"nowrap"}}>
                            {p.plc_machine_name || "—"}
                          </td>
                          <td style={{padding:"9px 13px",fontSize:11,color:"#111827",
                            fontFamily:"inherit",fontWeight:500,whiteSpace:"nowrap"}}>
                            {p.createdAt?new Date(p.createdAt).toLocaleString("en-IN",{
                              day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—"}
                          </td>
                          {stationColumns.map((col) => {
                            const cellValue = p[`station_${col.key}`];
                            const st = typeof cellValue === "object"
                              ? String(cellValue?.status || "").trim().toUpperCase()
                              : String(cellValue || "").trim().toUpperCase();
                            const badge =
                              st === "OK"
                                ? { v: "ok", l: "OK" }
                                : st === "NG"
                                  ? { v: "ng", l: "NG" }
                                  : st === "IN_PROGRESS"
                                    ? { v: "wip", l: t("production.inProgress", "In Progress") }
                                    : null;
                            return (
                              <td key={`${i}-${col.key}`} style={{padding:"9px 13px"}}>
                                {badge ? <Bdg v={badge.v} l={badge.l}/> : <span style={{color:"#111827"}}>—</span>}
                              </td>
                            );
                          })}
                          <td style={{padding:"9px 13px",minWidth:170,textAlign:"center"}}>
                            <Bdg v={finalBadge.v} l={finalBadge.l}/>
                          </td>
                          {plcColumns.map((c) => (
                            <td key={`${i}-plc-${c.key}`} style={{padding:"9px 13px",fontSize:11,color:"#111827",fontFamily:"inherit",fontWeight:500,textAlign:"center",whiteSpace:"nowrap",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis"}}>
                              {c.key === "shot_status"
                                ? (() => {
                                    const rawValue = p[`plc_${c.key}`];
                                    const textValue = String(rawValue || "").trim().toUpperCase();
                                    if (textValue === "OK") return <Bdg v="ok" l="OK" />;
                                    if (textValue === "WARM UP SHOT") return <Bdg v="ng" l="WARM UP SHOT" />;
                                    if (textValue === "OFF SHOT") return <Bdg v="ng" l="OFF SHOT" />;
                                    return renderCellValue(rawValue);
                                  })()
                                : renderCellValue(p[`plc_${c.key}`])}
                            </td>
                          ))}
                          {LEAK_TEST_COLUMNS.map((c) => (
                            <td key={`${i}-leak-${c.key}`} style={{padding:"9px 13px",fontSize:11,color:"#111827",fontFamily:"inherit",fontWeight:500,textAlign:"center",whiteSpace:"nowrap",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis"}}>
                              {(() => {
                                const leakValue = renderCellValue(p[`leak_${c.key}`]);
                                if (leakValue === "-" || leakValue === "—") {
                                  return <Bdg v="idle" l="-" />;
                                }
                                return leakValue;
                              })()}
                            </td>
                          ))}
                          <td style={{padding:"9px 13px",fontSize:10,color:isNg?C.ng():C.txt("muted"),
                              maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {sanitizeDisplayReason(p.ngReason)||""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",
              padding:"10px 12px",borderRadius:10,background:C.bg("card"),border:`1px solid ${C.bdr()}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:C.txt("muted")}}>
                <span>{t("production.rowsPerPage", "Rows / page")}</span>
                <select
                  value={partsPageSize}
                  onChange={(e)=>setPartsPageSize(Number(e.target.value) || 25)}
                  style={{height:30,padding:"0 8px",borderRadius:6,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:11}}
                >
                  {[10,25,50,100].map((s)=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button
                  onClick={()=>setPartsPage((p)=>Math.max(1, p-1))}
                  disabled={partsPage<=1}
                  style={{height:30,padding:"0 12px",borderRadius:6,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:"#111827",fontSize:11,cursor:"pointer",opacity:partsPage<=1?0.5:1}}
                >
                  Prev
                </button>
                <span style={{height:30,padding:"0 12px",borderRadius:6,display:"inline-flex",alignItems:"center",
                  background:C.navy(),color:C.linen(),fontWeight:800,fontSize:11}}>
                  {t("production.page", "Page")} {partsPage} / {totalPartsPages}
                </span>
                <button
                  onClick={()=>setPartsPage((p)=>Math.min(totalPartsPages, p+1))}
                  disabled={partsPage>=totalPartsPages}
                  style={{height:30,padding:"0 12px",borderRadius:6,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:"#111827",fontSize:11,cursor:"pointer",opacity:partsPage>=totalPartsPages?0.5:1}}
                >
                  Next
                </button>
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {selectedMachineDetail && (
        <div style={{position:"fixed",inset:0,zIndex:80,display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div
            onClick={()=>setSelectedMachineDetail(null)}
            style={{position:"absolute",inset:0,background:"rgba(5,10,20,0.72)",backdropFilter:"blur(6px)"}}
          />
          <div style={{position:"relative",width:"min(1040px,96vw)",maxHeight:"88vh",overflow:"hidden",background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14,boxShadow:SHM,display:"flex",flexDirection:"column"}}>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.bdr()}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:C.bg("surf")}}>
              <div>
                <p style={{fontSize:15,fontWeight:900,color:C.txt("pri")}}>{selectedMachineDetail.machineName}</p>
                <p style={{fontSize:11,color:C.txt("muted"),marginTop:3}}>
                  {selectedMachineDetail.lineName || "-"} · {selectedMachineDetail.stationNo || "-"} · {timeLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={()=>setSelectedMachineDetail(null)}
                title="Close"
                style={{width:32,height:32,borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("card"),color:C.txt("sec"),display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}
              >
                <X size={16}/>
              </button>
            </div>

            <div style={{padding:16,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,borderBottom:`1px solid ${C.bdr()}`}}>
              {[
                {label:t("production.total", "Total"),value:selectedMachineCounts.passed + selectedMachineCounts.failed,color:C.txt("pri")},
                {label:t("production.target", "Target"),value:selectedMachineDetail.target||0,color:C.steel()},
                {label:t("production.achieved", "Achieved"),value:`${Number(selectedMachineDetail.achievementPct||0)}%`,color:C.amber()},
                {label:t("production.passed", "Passed"),value:selectedMachineCounts.passed,color:C.ok()},
                {label:t("production.failed", "Failed"),value:selectedMachineCounts.failed,color:C.ng()},
                {label:t("production.inProgress", "In Progress"),value:selectedMachineCounts.progress,color:C.wip()},
                {label:t("dashboard.downtime", "Downtime"),value:`${Math.round(Number(selectedMachineDetail.downtimeMinutes||0))}m`,color:C.txt("muted")},
              ].map((item)=>(
                <div key={item.label} style={{padding:"10px 12px",borderRadius:10,border:`1px solid ${C.bdr()}`,background:C.bg("surf")}}>
                  <p style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:"0.08em",color:C.txt("muted"),marginBottom:5}}>{item.label}</p>
                  <p style={{fontSize:20,fontWeight:900,fontFamily:"'DM Mono',monospace",color:item.color,lineHeight:1}}>{item.value}</p>
                </div>
              ))}
            </div>

            <div style={{padding:16,overflow:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                    {machineDetailHeaders.map((h)=>(
                      <th key={h} style={{padding:"9px 11px",textAlign:"left",fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:"0.08em",color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedMachineParts.length === 0 ? (
                    <tr><td colSpan={6} style={{padding:"34px",textAlign:"center",color:C.txt("muted")}}>{t("production.noPartRecordsForMachine", "No part records found for this machine and filter.")}</td></tr>
                  ) : selectedMachineParts.slice(0, 200).map((part, idx) => {
                    const stageSnapshot = getSelectedMachineStageSnapshot(part);
                    const badge = stageSnapshot.state === "passed" ? {v:"ok", l:t("production.passed", "Passed")} : stageSnapshot.state === "failed" ? {v:"ng", l:t("production.failed", "Failed")} : {v:"idle", l:t("production.inProgress", "In Progress")};
                    return (
                      <tr key={part.id || `${part.partId}-${idx}`} style={{borderBottom:`1px solid ${C.bdr()}`,background:idx%2===1?C.bg("surf"):"transparent"}}>
                        <td style={{padding:"9px 11px",color:C.txt("muted")}}>{idx+1}</td>
                        <td style={{padding:"9px 11px",fontWeight:800,color:C.txt("pri"),fontFamily:"'DM Mono',monospace"}}>{part.partId || part.part_id || "-"}</td>
                        <td style={{padding:"9px 11px"}}><Bdg v={badge.v} l={badge.l}/></td>
                        <td style={{padding:"9px 11px",color:C.txt("sec")}}>{stageSnapshot.normalizedStatus === "OK" ? "OK" : stageSnapshot.normalizedStatus === "NG" ? "NG" : (stageSnapshot.result || "-")}</td>
                        <td style={{padding:"9px 11px",color:C.txt("muted"),maxWidth:260,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sanitizeDisplayReason(stageSnapshot.reason) || ""}</td>
                        <td style={{padding:"9px 11px",color:C.txt("sec"),whiteSpace:"nowrap"}}>{stageSnapshot.createdAt ? new Date(stageSnapshot.createdAt).toLocaleString("en-IN") : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {selectedMachineParts.length > 200 && (
                <p style={{fontSize:11,color:C.txt("muted"),marginTop:10}}>{t("production.showingLatest200", "Showing latest 200 records.")} ({selectedMachineParts.length})</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ProductionCharts;
