// ============================================================
//  ProductionCharts.jsx — IndusTrace Premium v4
//  ✓ Download bar at TOP
//  ✓ Tabs: Overview | Hourly | Machine | Shift | Parts List
//  ✓ Excel exports: Full / Parts / Audit
//  ✓ Navy/Steel/Amber/Linen theme
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp, Download, RefreshCw, BarChart3,
  LineChart as LineChartIcon, AlertCircle, Clock,
  Cpu, Target, Activity, Table2,
  CheckCircle2, XCircle, Package, Zap,
  PieChart as PieIcon, Settings2, Calendar,
  List, LayoutDashboard, TrendingDown,
} from "lucide-react";
import {
  LineChart as ReLineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart as RePieChart,
  Pie, Cell, AreaChart, Area, Legend,
} from "recharts";
import { dashboardApi, machineApi } from "../api/services";
import { CHART_COLORS, STATUS_COLORS } from "../constants/chartTheme";

// ── Design tokens ──────────────────────────────────────────────────────────
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

// ── Helpers ────────────────────────────────────────────────────────────────
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function toDateRange(r){
  const now=new Date(),from=new Date(now);
  if(r==="daily")from.setHours(0,0,0,0);
  else if(r==="weekly")from.setDate(now.getDate()-7);
  else from.setDate(now.getDate()-30);
  return{dateFrom:from.toISOString(),dateTo:now.toISOString()};
}
const fmtH  =h=>(h!==undefined&&h!==null&&!Number.isNaN(Number(h)))?`${String(Number(h)).padStart(2,"0")}:00`:String(h||"");
const fmtNow=()=>new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
const dateStr=()=>new Date().toISOString().slice(0,10);
const localDateTimeToIso = (value) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

// ── Tooltip ────────────────────────────────────────────────────────────────
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

// ── Card ───────────────────────────────────────────────────────────────────
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

// ── KPI card ───────────────────────────────────────────────────────────────
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

// ── Shift card ─────────────────────────────────────────────────────────────
const ShiftCard=({label,row,colorFn,icon:SIcon})=>{
  const t=Number(row?.total||0),ok=Number(row?.ok||0),ng=t-ok,eff=t>0?Math.round(ok/t*100):0;
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
          <p style={{fontSize:18,fontWeight:900,color:colorFn(),fontFamily:"'DM Mono',monospace",lineHeight:1}}>{t}</p>
          <p style={{fontSize:9,color:C.txt("muted"),marginTop:1}}>units</p>
        </div>
      </div>
      <div style={{height:5,borderRadius:99,background:C.bdr(0.14),overflow:"hidden",marginBottom:7,display:"flex"}}>
        <div style={{background:C.ok(),height:"100%",width:`${t>0?ok/t*100:0}%`,transition:"width .5s"}}/>
        <div style={{background:C.ng(),height:"100%",width:`${t>0?ng/t*100:0}%`,transition:"width .5s"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
        <span style={{color:C.ok(),fontWeight:700}}>✓ {ok} Pass</span>
        <span style={{color:C.ng(),fontWeight:700}}>✗ {ng} Fail</span>
        <span style={{fontWeight:800,fontFamily:"'DM Mono',monospace",
          color:eff>=85?C.ok():eff>=60?C.wip():C.ng()}}>{eff}%</span>
      </div>
    </div>
  );
};

// ── Badge ──────────────────────────────────────────────────────────────────
const Bdg=({v="idle",l})=>{
  const m={ok:{fg:C.ok(),bg:C.ok(0.1),bd:C.ok(0.25)},ng:{fg:C.ng(),bg:C.ng(0.1),bd:C.ng(0.25)},
    wip:{fg:C.wip(),bg:C.wip(0.1),bd:C.wip(0.25)},idle:{fg:C.idle(),bg:C.idle(0.08),bd:C.idle(0.2)}};
  const s=m[v]||m.idle;
  return<span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 9px",
    borderRadius:99,fontSize:11,fontWeight:700,color:s.fg,background:s.bg,border:`1px solid ${s.bd}`}}>
    <span style={{width:5,height:5,borderRadius:"50%",background:s.fg}}/>{l}</span>;
};

// ══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
const ProductionCharts=()=>{
  injectDS();

  const[timeRange, setTimeRange] =useState("weekly");
  const[customDate,setCustomDate]=useState({from:"",to:""});
  const[chartType, setChartType] =useState("bar");
  const[activeTab, setActiveTab] =useState("overview");
  const[loading,   setLoading]   =useState(false);
  const[error,     setError]     =useState("");
  const[machines,  setMachines]  =useState([]);
  const[partsList, setPartsList] =useState([]);
  const[partsSearch,setPartsSearch]=useState("");
  const[partsFilter,setPartsFilter]=useState("all");
  const[filters,setFilters]=useState({
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
    availableLines:[],
    availableShifts:[],
    partsList:[],
  });

  const query=useMemo(()=>{
    const commonFilters = {
      machineId: filters.machineId || undefined,
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
    setLoading(true);setError("");
    try{
      const[s,r,m]=await Promise.all([
        dashboardApi.summary(query),
        dashboardApi.report(query),
        machineApi.list(),
      ]);
      setSummary(s||summary);
      setReport(r||report);
      setMachines(m||[]);
      // Load parts list if available
      try{
        const parts=await dashboardApi.partsList?.(query)||r?.partsList||[];
        setPartsList(parts);
      }catch{}
    }catch(e){setError(e.response?.data?.error||"Failed to load analytics data.");}
    finally{setLoading(false);}
  },[query]);

  useEffect(()=>{loadData();},[loadData]);

  const machineMap=useMemo(()=>new Map(machines.map(m=>[Number(m.id),m])),[machines]);
  const lineContextLabel = useMemo(() => {
    const selectedMachineId = Number(filters.machineId || 0);
    if (selectedMachineId) {
      const selected = machines.find((m) => Number(m.id) === selectedMachineId);
      if (selected?.lineName) {
        return `Line: ${selected.lineName}`;
      }
    }
    if (filters.lineName) {
      return `Line: ${filters.lineName}`;
    }
    const lineSet = new Set((machines || []).map((m) => String(m.lineName || "").trim()).filter(Boolean));
    if (lineSet.size === 0) return "Line: All";
    if (lineSet.size === 1) return `Line: ${Array.from(lineSet)[0]}`;
    return `Line: All (${lineSet.size})`;
  }, [machines, filters.machineId, filters.lineName]);
  const totalOk   =Number(summary.quality?.ok||0);
  const totalNg   =Number(summary.quality?.ng||0);
  const totalUnits=totalOk+totalNg;
  const efficiency=totalUnits>0?Math.round(totalOk/totalUnits*100):0;

  const qualityPie=useMemo(()=>[
    {name:"Pass (OK)",value:totalOk},
    {name:"Fail (NG)",value:totalNg},
  ],[totalOk,totalNg]);

  const productionData=useMemo(()=>
    (report.hourlyProduction||[]).map(r=>({
      hour:fmtH(r.hour),Pass:Number(r.ok||0),Fail:Number(r.ng||0),Total:Number(r.total||0),
    })),[report.hourlyProduction]);

  const machineBarData=useMemo(()=>
    (report.machineWise||[]).map(r=>{
      const mObj = machineMap.get(Number(r.machine_id));
      const mName = String(mObj?.machine_name || mObj?.machineName || `M${r.machine_id}`);
      return {
        name: mName.slice(0,12),
        Pass:Number(r.ok||0),Fail:Number(r.ng||0),
      };
    }),[machineMap,report.machineWise]);

  const timeLabel=useMemo(()=>{
    if(timeRange==="daily")return"Today";
    if(timeRange==="weekly")return"Last 7 Days";
    if(timeRange==="monthly")return"Last 30 Days";
    if(customDate.from&&customDate.to){
      const from = new Date(customDate.from);
      const to = new Date(customDate.to);
      return `${Number.isNaN(from.getTime()) ? customDate.from : from.toLocaleString("en-IN")} to ${Number.isNaN(to.getTime()) ? customDate.to : to.toLocaleString("en-IN")}`;
    }
    return"Custom";
  },[timeRange,customDate]);
  const selectedFilterCount = useMemo(() => {
    const base = Object.values(filters).filter(Boolean).length;
    const timeFilters = (customDate.from ? 1 : 0) + (customDate.to ? 1 : 0);
    return base + timeFilters;
  }, [filters, customDate]);

  // Filtered parts for Parts tab
  const filteredParts=useMemo(()=>{
    let p=partsList;
    if(partsSearch){
      const s=partsSearch.toLowerCase();
      p=p.filter(x=>(x.partId||"").toLowerCase().includes(s)||(x.batchNo||x.batch||"").toLowerCase().includes(s));
    }
    if(partsFilter!=="all"){
      p=p.filter(x=>{
        const r=String(x.result||x.status||"").toUpperCase();
        const isOk=["OK","PASS","COMPLETED","ENDED_OK"].includes(r);
        const isNg=["NG","FAIL","FAILED","ENDED_NG","INTERLOCKED"].includes(r);
        if(partsFilter==="pass")return isOk;
        if(partsFilter==="fail")return isNg;
        if(partsFilter==="progress")return!isOk&&!isNg;
        return true;
      });
    }
    return p;
  },[partsList,partsSearch,partsFilter]);

  const handleFullExcel = async () => {
    try {
      const blob = await dashboardApi.exportFullReport(query);
      downloadBlob(
        new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Production_Report_${dateStr()}.xlsx`
      );
    } catch {
      setError("Full report export failed.");
    }
  };

  const handleDownloadReport = handleFullExcel;

  const axStyle={fontSize:11,fill:C.txt("muted"),fontFamily:"monospace"};

  const TABS=[
    {key:"overview",  label:"Overview",      icon:LayoutDashboard},
    {key:"hourly",    label:"Hourly Trend",  icon:BarChart3      },
    {key:"machine",   label:"By Machine",    icon:Cpu            },
    {key:"shift",     label:"By Shift",      icon:Zap            },
    {key:"parts",     label:`Parts List${partsList.length?` (${partsList.length})`:""}`, icon:List},
  ];

  // ── RENDER ─────────────────────────────────────────────────────────────
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16,paddingBottom:32,animation:"pcFadeIn .3s ease"}}>

      {/* ══ PAGE HEADER ════════════════════════════════════════════════ */}
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
                    Production Report
                  </h1>
                  <span style={{fontSize:10,fontWeight:700,color:C.amber(),
                    background:C.amber(0.1),padding:"2px 9px",borderRadius:99,
                    border:`1px solid ${C.amber(0.3)}`}}>LIVE</span>
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
                  {k==="daily"?"Today":k==="weekly"?"7 Days":"30 Days"}
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
                {loading?"Loading…":"Refresh"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ══ DOWNLOAD BAR — TOP ═══════════════════════════════════════ */}
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
        <select
          value={filters.lineName}
          onChange={(e)=>setFilters((prev)=>({...prev,lineName:e.target.value,machineId:""}))}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        >
          <option value="">All Lines</option>
          {(report.availableLines || []).map((line)=>(
            <option key={line} value={line}>{line}</option>
          ))}
        </select>
        <select
          value={filters.machineId}
          onChange={(e)=>setFilters((prev)=>({...prev,machineId:e.target.value}))}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        >
          <option value="">All Machines</option>
          {machines
            .filter((m)=>!filters.lineName || String(m.lineName || "").trim() === filters.lineName)
            .map((m)=>(
              <option key={m.id} value={m.id}>{m.machineName}</option>
            ))}
        </select>
        <input
          value={filters.partId}
          onChange={(e)=>setFilters((prev)=>({...prev,partId:e.target.value}))}
          placeholder="Part ID"
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        />
        <select
          value={filters.status}
          onChange={(e)=>setFilters((prev)=>({...prev,status:e.target.value}))}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        >
          <option value="">All Status</option>
          <option value="OK">PASSED</option>
          <option value="NG">FAILED</option>
        </select>
        <select
          value={filters.shiftCode}
          onChange={(e)=>setFilters((prev)=>({...prev,shiftCode:e.target.value}))}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.bdr()}`,background:C.bg("surf"),color:C.txt("pri"),fontSize:12}}
        >
          <option value="">All Shifts</option>
          {(report.availableShifts || []).map((shift)=>(
            <option key={shift.shiftCode} value={shift.shiftCode}>{shift.shiftName || shift.shiftCode}</option>
          ))}
        </select>
        <button
          onClick={()=>setFilters({machineId:"",lineName:"",partId:"",status:"",shiftCode:""})}
          style={{height:34,padding:"0 10px",borderRadius:8,border:`1px solid ${C.ng(0.3)}`,background:C.ng(0.08),color:C.ng(),fontSize:12,fontWeight:700,cursor:"pointer"}}
        >
          Clear
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
            <p style={{fontSize:13,fontWeight:800,color:C.txt("pri")}}>Download Report</p>
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
            Filters Selected: {selectedFilterCount}
          </span>
          <button onClick={handleDownloadReport}
            style={{display:"inline-flex",alignItems:"center",gap:6,height:36,padding:"0 14px",
              borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
              background:C.steel(0.1),border:`1px solid ${C.steel(0.3)}`,color:C.steel(),transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.2)}
            onMouseLeave={e=>e.currentTarget.style.background=C.steel(0.1)}>
            <Download size={13}/> Download Report
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

      {/* ══ KPI ROW ════════════════════════════════════════════════════ */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:11}}>
        <KpiCard label="Total Produced" value={totalUnits} sub={`Period: ${timeLabel}`} icon={Package}
          color={C.navy()} bgC={C.navy(0.07)} bdC={C.navy(0.22)}/>
        <KpiCard label="Pass (OK)"      value={totalOk}   sub="Quality approved" icon={CheckCircle2}
          color={C.ok()} bgC={C.ok(0.07)} bdC={C.ok(0.22)}/>
        <KpiCard label="Fail (NG)"      value={totalNg}   sub="Failed quality check" icon={XCircle}
          color={C.ng()} bgC={C.ng(0.07)} bdC={C.ng(0.22)}/>
        <KpiCard label="Quality Rate"   value={`${efficiency}%`} sub="Pass / Total" icon={TrendingUp}
          color={efficiency>=85?C.ok():efficiency>=60?C.wip():C.ng()}
          bgC={efficiency>=85?C.ok(0.07):efficiency>=60?C.wip(0.07):C.ng(0.07)}
          bdC={efficiency>=85?C.ok(0.22):efficiency>=60?C.wip(0.22):C.ng(0.22)}/>
        <KpiCard label="In Progress"    value={summary.parts?.inProgress||0} sub="Currently processing" icon={Activity}
          color={C.steel()} bgC={C.steel(0.07)} bdC={C.steel(0.22)}/>
        <KpiCard label="Interlocked"    value={summary.parts?.interlocked||0} sub="PLC blocked" icon={AlertCircle}
          color={C.wip()} bgC={C.wip(0.07)} bdC={C.wip(0.22)}/>
      </div>

      {/* ══ TABS ═══════════════════════════════════════════════════════ */}
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

      {/* ══ TAB: OVERVIEW ══════════════════════════════════════════════ */}
      {activeTab==="overview"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:14,alignItems:"start",animation:"pcFadeIn .2s ease"}}>
          {/* Quality donut + parts status */}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Card title="Quality Summary" subtitle="Pass vs Fail ratio" icon={PieIcon} accent={C.amber()}>
              <div style={{display:"flex",alignItems:"center",gap:24,padding:"8px 0"}}>
                {/* Donut */}
                <div style={{position:"relative",width:160,height:160,flexShrink:0}}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                    <RePieChart>
                      <Pie data={qualityPie} cx="50%" cy="50%" innerRadius={52} outerRadius={72}
                        paddingAngle={3} dataKey="value" strokeWidth={0}>
                        <Cell fill={C.ok()}/><Cell fill={C.ng()}/>
                      </Pie>
                      <Tooltip content={<TipBox/>}/>
                    </RePieChart>
                  </ResponsiveContainer>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
                    alignItems:"center",justifyContent:"center"}}>
                    <p style={{fontSize:22,fontWeight:900,lineHeight:1,
                      color:efficiency>=85?C.ok():efficiency>=60?C.wip():C.ng(),
                      fontFamily:"'DM Mono',monospace"}}>{efficiency}%</p>
                    <p style={{fontSize:9,color:C.txt("muted"),marginTop:3,
                      textTransform:"uppercase",letterSpacing:"0.07em"}}>Quality</p>
                  </div>
                </div>
                {/* Stats */}
                <div style={{flex:1,display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    {l:"Pass (OK)",  v:totalOk,  c:C.ok(),   bg:C.ok(0.08),  bd:C.ok(0.2)},
                    {l:"Fail (NG)",  v:totalNg,  c:C.ng(),   bg:C.ng(0.08),  bd:C.ng(0.2)},
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
            <Card title="Parts Status" subtitle="Breakdown" icon={Settings2} accent={C.navy()}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
                {[
                  {l:"Completed",  v:summary.parts?.completed||0,  c:C.ok()  },
                  {l:"In Progress",v:summary.parts?.inProgress||0, c:C.steel()},
                  {l:"Interlocked",v:summary.parts?.interlocked||0,c:C.wip() },
                  {l:"Rework",     v:summary.parts?.rework||0,     c:C.ng()  },
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
              letterSpacing:"0.1em",color:C.txt("muted")}}>Shift Performance</p>
            {[{key:"SHIFT_A",label:"Shift A — Morning",  colorFn:C.steel,icon:Zap    },
              {key:"SHIFT_B",label:"Shift B — Afternoon",colorFn:C.amber,icon:Activity},
              {key:"SHIFT_C",label:"Shift C — Night",    colorFn:C.idle, icon:Clock  }
            ].map(s=>(
              <ShiftCard key={s.key} label={s.label}
                row={report.shiftProduction?.[s.key]}
                colorFn={s.colorFn} icon={s.icon}/>
            ))}
          </div>
        </div>
      )}

      {/* ══ TAB: HOURLY ═══════════════════════════════════════════════ */}
      {activeTab==="hourly"&&(
        <div style={{animation:"pcFadeIn .2s ease"}}>
          <Card title="Hourly Production" subtitle="Pass vs Fail per hour" icon={BarChart3} accent={C.steel()}
            right={
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{display:"flex",gap:8,marginRight:4}}>
                  {[{c:C.ok(),l:"Pass"},{c:C.ng(),l:"Fail"}].map(s=>(
                    <div key={s.l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.txt("muted")}}>
                      <div style={{width:10,height:10,borderRadius:3,background:s.c}}/>{s.l}
                    </div>
                  ))}
                </div>
                {[{k:"bar",label:"Bar"},{k:"line",label:"Line"},{k:"area",label:"Area"}].map(t=>(
                  <button key={t.k} onClick={()=>setChartType(t.k)}
                    style={{height:28,padding:"0 10px",borderRadius:6,fontSize:11,cursor:"pointer",
                      background:chartType===t.k?C.navy():"transparent",
                      border:`1px solid ${chartType===t.k?C.navy(0.5):C.bdr()}`,
                      color:chartType===t.k?C.linen():C.txt("muted"),fontWeight:700,transition:"all .12s"}}>
                    {t.label}
                  </button>
                ))}
              </div>
            }>
            {productionData.length===0?(
              <div style={{height:350,display:"flex",alignItems:"center",justifyContent:"center",
                flexDirection:"column",gap:8,color:C.txt("muted"),fontSize:12}}>
                <BarChart3 size={28} color={C.txt("muted")}/>No hourly data for this period.
              </div>
            ):(
              <div style={{height:350}}>
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                  {chartType==="area"?(
                    <AreaChart data={productionData} margin={{top:4,right:8,bottom:0,left:-10}}>
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
                      <Area type="monotone" dataKey="Pass" stroke={C.ok()} strokeWidth={2.5} fill="url(#gOk)" dot={false}/>
                      <Area type="monotone" dataKey="Fail" stroke={C.ng()} strokeWidth={2} fill="url(#gNg)" dot={false}/>
                    </AreaChart>
                  ):chartType==="line"?(
                    <ReLineChart data={productionData} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.1)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey="hour" tick={axStyle} axisLine={false} tickLine={false}/>
                      <YAxis tick={axStyle} axisLine={false} tickLine={false}/>
                      <Tooltip content={<TipBox/>}/>
                      <Line type="monotone" dataKey="Pass" stroke={C.ok()} strokeWidth={2.5} dot={false} activeDot={{r:4,fill:C.ok()}}/>
                      <Line type="monotone" dataKey="Fail" stroke={C.ng()} strokeWidth={2} dot={false} strokeDasharray="5 3" activeDot={{r:4,fill:C.ng()}}/>
                      <Line type="monotone" dataKey="Total" stroke={C.steel()} strokeWidth={1.5} dot={false} strokeDasharray="2 5"/>
                    </ReLineChart>
                  ):(
                    <BarChart data={productionData} barGap={3} margin={{top:4,right:8,bottom:0,left:-10}}>
                      <CartesianGrid stroke={C.bdr(0.1)} strokeDasharray="3 4" vertical={false}/>
                      <XAxis dataKey="hour" tick={axStyle} axisLine={false} tickLine={false}/>
                      <YAxis tick={axStyle} axisLine={false} tickLine={false}/>
                      <Tooltip content={<TipBox/>}/>
                      <Bar dataKey="Pass" fill={C.ok()} radius={[4,4,0,0]} maxBarSize={22}/>
                      <Bar dataKey="Fail" fill={C.ng()} radius={[4,4,0,0]} maxBarSize={22}/>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11,paddingTop:8,color:C.txt("muted")}}/>
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ══ TAB: BY MACHINE ═══════════════════════════════════════════ */}
      {activeTab==="machine"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14,animation:"pcFadeIn .2s ease"}}>
          {/* Chart */}
          <Card title="Machine-wise Production" subtitle="Pass vs Fail per machine" icon={Cpu} accent={C.navy()}>
            {machineBarData.length===0?(
              <div style={{height:260,display:"flex",alignItems:"center",justifyContent:"center",
                flexDirection:"column",gap:8,color:C.txt("muted"),fontSize:12}}>
                <Cpu size={26} color={C.txt("muted")}/>No machine data.
              </div>
            ):(
              <div style={{height:260}}>
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                  <BarChart data={machineBarData} barGap={3} margin={{top:4,right:8,bottom:0,left:-10}}>
                    <CartesianGrid stroke={C.bdr(0.1)} strokeDasharray="3 4" vertical={false}/>
                    <XAxis dataKey="name" tick={{...axStyle,fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis tick={axStyle} axisLine={false} tickLine={false}/>
                    <Tooltip content={<TipBox/>}/>
                    <Bar dataKey="Pass" fill={C.ok()} radius={[4,4,0,0]} maxBarSize={22}/>
                    <Bar dataKey="Fail" fill={C.ng()} radius={[4,4,0,0]} maxBarSize={22}/>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11,paddingTop:8,color:C.txt("muted")}}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          {/* Machine table */}
          <Card noPad title="Machine Performance Summary" subtitle="Quality rate per machine" icon={Cpu} accent={C.steel()}
            right={<div style={{display:"flex",gap:8}}><Bdg v="ok" l="≥85%"/><Bdg v="wip" l="60-84%"/><Bdg v="ng" l="<60%"/></div>}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                    {["#","Machine","Total","Pass","Fail","Quality %","Progress","Status"].map(h=>(
                      <th key={h} style={{padding:"9px 13px",textAlign:"left",fontSize:9,fontWeight:800,
                        textTransform:"uppercase",letterSpacing:"0.09em",color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(report.machineWise||[]).length===0?(
                    <tr><td colSpan={8} style={{padding:"36px",textAlign:"center",color:C.txt("muted"),fontSize:12}}>No data.</td></tr>
                  ):(report.machineWise||[]).map((row,i)=>{
                    const t=(Number(row.ok||0))+(Number(row.ng||0));
                    const eff=t>0?Math.round(Number(row.ok||0)/t*100):0;
                    const machine=machineMap.get(Number(row.machine_id));
                    const name = String(machine?.machineName || machine?.machine_name || machine?.machineNumber || `Machine ${row.machine_id}`);
                    const v=eff>=85?"ok":eff>=60?"wip":"ng";
                    const vc=v==="ok"?C.ok():v==="wip"?C.wip():C.ng();
                    return(
                      <tr key={i} style={{borderBottom:`1px solid ${C.bdr()}`,
                        background:i%2===1?C.bg("surf"):"transparent",transition:"background .1s"}}
                        onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.04)}
                        onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.bg("surf"):"transparent"}>
                        <td style={{padding:"10px 13px",color:C.txt("muted"),fontSize:11}}>{i+1}</td>
                        <td style={{padding:"10px 13px",fontWeight:700,color:C.txt("pri")}}>{name}</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.txt("pri"),textAlign:"center"}}>{t}</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.ok(),textAlign:"center"}}>{row.ok||0}</td>
                        <td style={{padding:"10px 13px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.ng(),textAlign:"center"}}>{row.ng||0}</td>
                        <td style={{padding:"10px 13px",textAlign:"center"}}>
                          <span style={{fontSize:13,fontWeight:800,color:vc,fontFamily:"'DM Mono',monospace"}}>{eff}%</span>
                        </td>
                        <td style={{padding:"10px 13px",minWidth:90}}>
                          <div style={{height:5,borderRadius:99,background:C.bdr(0.14),overflow:"hidden"}}>
                            <div style={{height:"100%",background:vc,width:`${eff}%`,transition:"width .5s"}}/>
                          </div>
                        </td>
                        <td style={{padding:"10px 13px"}}><Bdg v={v} l={v==="ok"?"Good":v==="wip"?"Average":"Low"}/></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ══ TAB: BY SHIFT ═════════════════════════════════════════════ */}
      {activeTab==="shift"&&(
        <div style={{animation:"pcFadeIn .2s ease"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:14}}>
            {[{key:"SHIFT_A",label:"Shift A — Morning",  colorFn:C.steel,icon:Zap    },
              {key:"SHIFT_B",label:"Shift B — Afternoon",colorFn:C.amber,icon:Activity},
              {key:"SHIFT_C",label:"Shift C — Night",    colorFn:C.idle, icon:Clock  }
            ].map(s=>(
              <ShiftCard key={s.key} label={s.label}
                row={report.shiftProduction?.[s.key]}
                colorFn={s.colorFn} icon={s.icon}/>
            ))}
          </div>
          {/* Shift table */}
          <div style={{marginTop:14}}>
            <Card noPad title="Shift Performance Details" subtitle="Complete breakdown" icon={Activity} accent={C.amber()}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                    {["Shift","Total Produced","Pass (OK)","Fail (NG)","Quality Rate","Progress"].map(h=>(
                      <th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:9,fontWeight:800,
                        textTransform:"uppercase",letterSpacing:"0.09em",color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.shiftProduction||{}).map(([sh,row],i)=>{
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

      {/* ══ TAB: PARTS LIST ═══════════════════════════════════════════ */}
      {activeTab==="parts"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12,animation:"pcFadeIn .2s ease"}}>

          {/* Filter + search bar */}
          <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
            borderRadius:12,padding:"12px 16px",boxShadow:SH,
            display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            {/* Search */}
            <div style={{position:"relative",flex:"1 1 200px",minWidth:160}}>
              <input value={partsSearch} onChange={e=>setPartsSearch(e.target.value)}
                placeholder="Search part serial or batch…"
                style={{width:"100%",height:36,paddingLeft:14,paddingRight:12,
                  background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,color:C.txt("pri"),outline:"none",
                  boxSizing:"border-box",fontFamily:"'DM Mono',monospace"}}/>
            </div>
            {/* Filter buttons */}
            <div style={{display:"flex",gap:5,padding:3,background:C.bg("surf"),
              border:`1px solid ${C.bdr()}`,borderRadius:8}}>
              {[{k:"all",l:"All"},
                {k:"pass",l:`✓ Pass`},
                {k:"fail",l:`✗ Fail`},
                {k:"progress",l:"In Progress"}].map(f=>(
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
                Showing <strong style={{color:C.txt("pri")}}>{filteredParts.length}</strong> of <strong style={{color:C.txt("pri")}}>{partsList.length}</strong> parts
              </span>
            </div>
          </div>

          {partsList.length===0?(
            <div style={{padding:"56px 24px",textAlign:"center",
              background:C.bg("card"),border:`1px solid ${C.bdr()}`,borderRadius:14}}>
              <List size={32} color={C.txt("muted")} style={{margin:"0 auto 14px"}}/>
              <p style={{fontSize:14,fontWeight:600,color:C.txt("sec"),marginBottom:6}}>
                No parts data available
              </p>
              <p style={{fontSize:12,color:C.txt("muted")}}>
                Parts list is populated from the production scan history for this period.
              </p>
            </div>
          ):(
            <Card noPad title={`Production Parts List — ${filteredParts.length} records`}
              subtitle="All scanned parts this period" icon={List} accent={C.navy()}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                      {["#","Part Serial No.","Batch","Machine","Station","Result","Cycle Time (s)","Reason / Remark","Date & Time"].map(h=>(
                        <th key={h} style={{padding:"9px 13px",textAlign:"left",fontSize:9,
                          fontWeight:800,textTransform:"uppercase",letterSpacing:"0.09em",
                          color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParts.slice(0,200).map((p,i)=>{
                      const res=String(p.result||p.status||"").toUpperCase();
                      const isOk=["OK","PASS","COMPLETED","ENDED_OK"].includes(res);
                      const isNg=["NG","FAIL","FAILED","ENDED_NG","INTERLOCKED"].includes(res);
                      const v=isOk?"ok":isNg?"ng":"idle";
                      const label=isOk?"✓ Pass":isNg?"✗ Fail":res||"—";
                      return(
                        <tr key={i} style={{borderBottom:`1px solid ${C.bdr()}`,
                          background:i%2===1?C.bg("surf"):"transparent",transition:"background .1s"}}
                          onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.04)}
                          onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.bg("surf"):"transparent"}>
                          <td style={{padding:"9px 13px",color:C.txt("muted"),fontSize:10}}>{i+1}</td>
                          <td style={{padding:"9px 13px"}}>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,
                              fontWeight:700,color:C.txt("pri")}}>{p.partId||"—"}</span>
                          </td>
                          <td style={{padding:"9px 13px",fontSize:11,color:C.txt("sec")}}>
                            {p.batchNo||p.batch||"—"}
                          </td>
                          <td style={{padding:"9px 13px",fontSize:11,color:C.txt("pri"),fontWeight:600}}>
                            {p.machineName || machineMap.get(Number(p.machineId))?.machineName || "—"}
                          </td>
                          <td style={{padding:"9px 13px"}}>
                            <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",
                              color:C.steel(),fontWeight:600}}>
                              {p.stationNo||p.operationNo||"—"}
                            </span>
                          </td>
                          <td style={{padding:"9px 13px"}}>
                            <Bdg v={v} l={label}/>
                          </td>
                          <td style={{padding:"9px 13px"}}>
                            <div style={{display:"flex",flexDirection:"column",gap:2}}>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,
                                  color:p.cycleTime ? C.txt("pri") : C.txt("muted")}}>
                                  {p.cycleTime || "—"}
                                </span>
                                {p.cycleTime && (() => {
                                  const m = machineMap.get(Number(p.machineId));
                                  const std = (Number(m?.cycle_time || 0) + Number(m?.loading_time || 0));
                                  if (std > 0) {
                                    const diff = Number(p.cycleTime) - std;
                                    const isSlow = diff > 2; // Tolerance 2s
                                    return (
                                      <span style={{fontSize:9,fontWeight:800,padding:"1px 4px",borderRadius:4,
                                        background:isSlow ? C.ng(0.1) : C.ok(0.1),
                                        color:isSlow ? C.ng() : C.ok()}}>
                                        {isSlow ? `+${diff.toFixed(1)}s` : "Std"}
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                              {p.cycleTime && (
                                <span style={{fontSize:9,color:C.txt("muted")}}>
                                  sec
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{padding:"9px 13px",fontSize:10,color:isNg?C.ng():C.txt("muted"),
                            maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {p.interlockReason||p.reason||"—"}
                          </td>
                          <td style={{padding:"9px 13px",fontSize:10,color:C.txt("muted"),
                            fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>
                            {p.createdAt?new Date(p.createdAt).toLocaleString("en-IN",{
                              day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredParts.length>200&&(
                  <div style={{padding:"10px 14px",fontSize:11,color:C.txt("muted"),
                    background:C.bg("surf"),borderTop:`1px solid ${C.bdr()}`,
                    display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span>Showing first 200 of {filteredParts.length} records in view.</span>
                    <button onClick={handlePartsExcel}
                      style={{display:"inline-flex",alignItems:"center",gap:5,height:30,padding:"0 12px",
                        borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer",
                        background:C.steel(0.1),border:`1px solid ${C.steel(0.3)}`,color:C.steel()}}>
                      <Download size={11}/> Download all {filteredParts.length} as Excel
                    </button>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

    </div>
  );
};

export default ProductionCharts;


