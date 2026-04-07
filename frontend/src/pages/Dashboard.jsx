// ============================================================
//  Dashboard.jsx — IndusTrace Premium Redesign
//  Color Theme: Navy / Steel / Amber / Linen
//  Clean professional language — no jargon
//  Supports: Dark + Light via [data-theme] on <html>
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  Download, RefreshCw, Filter, CheckCircle2, XCircle,
  AlertTriangle, Cpu, Activity, History, Clock,
  BellRing, X, Shield, Zap, Target, Layers,
  TrendingUp, BarChart3, Settings2, ChevronDown,
  Circle, Wifi, WifiOff,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, Legend,
} from "recharts";
import { dashboardApi, machineApi } from "../api/services";
import ChartTooltip from "../components/charts/ChartTooltip";
import axios from "axios";
import { CHART_COLORS, chartAxisProps, chartGridProps } from "../constants/chartTheme";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const API_BASE   = import.meta.env.VITE_API_URL    || "http://localhost:4000/api";

// ── Design tokens ─────────────────────────────────────────────────────────
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
  }
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

// ── Color helpers ─────────────────────────────────────────────────────────
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

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a);
  a.click(); a.remove(); URL.revokeObjectURL(url);
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

// ── OEE Radial Gauge ──────────────────────────────────────────────────────
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

// ── Status Badge ─────────────────────────────────────────────────────────
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

// ── Alarm Banner ──────────────────────────────────────────────────────────

// ── KPI Card ─────────────────────────────────────────────────────────────
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
      <div style={{width:30,height:30,borderRadius:8,
        background:`rgba(${accent?accent.replace(/rgba\(|,\d+\)|\)$/g,"").replace(/rgb\(|,\d+,\d+\)$/g,""):"var(--db-steel)"},0.1)`,
        display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <Icon size={14} color={accent||C.steel()}/>
      </div>
    </div>
    <p style={{fontSize:30,fontWeight:800,color:C.txt("pri"),lineHeight:1,
      fontFamily:"'DM Mono',monospace",fontVariantNumeric:"tabular-nums"}}>{value}</p>
    {sub && <p style={{fontSize:11,color:C.txt("muted")}}>{sub}</p>}
  </div>
);

// ── Machine KPI Card ─────────────────────────────────────────────────────
const MachineCard = ({ row, plcOnline=true, nowMs=0 }) => {
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
      {/* PLC dot */}
      <div style={{position:"absolute",top:14,right:14,display:"flex",alignItems:"center",gap:5}}>
        <span style={{fontSize:9,fontWeight:700,color:C.txt("muted"),textTransform:"uppercase",letterSpacing:"0.06em"}}>PLC</span>
        <div style={{position:"relative",width:8,height:8}}>
          <div style={{position:"absolute",inset:0,borderRadius:"50%",
            background:plcOnline?C.ok():C.ng(),
            animation:plcOnline?"dbPing 1.8s ease-out infinite":"none",opacity:0.5}}/>
          <div style={{width:8,height:8,borderRadius:"50%",
            background:plcOnline?C.ok():C.ng()}}/>
        </div>
      </div>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
        <OeeGauge value={acc} size={56} stroke={6}/>
        <div style={{minWidth:0,flex:1}}>
          <p style={{fontSize:13,fontWeight:800,color:C.txt("pri"),
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
          { label:"Target",    value:row.targetQty,            color:C.txt("muted")},
          { label:"Achieved",  value:`${row.achievementPct||0}%`, color:color       },
        ].map((s,i)=>(
          <div key={i} style={{background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
            borderRadius:9,padding:"8px 6px",textAlign:"center"}}>
            <p style={{fontSize:14,fontWeight:800,color:s.color,
              fontFamily:"'DM Mono',monospace",lineHeight:1}}>{s.value}</p>
            <p style={{fontSize:9,fontWeight:700,color:C.txt("muted"),
              textTransform:"uppercase",letterSpacing:"0.06em",marginTop:4}}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        paddingTop:10,borderTop:`1px solid ${C.bdr()}`,flexWrap:"wrap",gap:6}}>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <Clock size={10} color={C.txt("muted")}/>
          <span style={{fontSize:10,color:scanColor,fontFamily:"'DM Mono',monospace"}}>
            {lastScan ? lastScan.toLocaleTimeString() : "No scan"}
          </span>
        </div>
        <div style={{display:"flex",gap:12}}>
          <span style={{fontSize:10,fontWeight:700,color:C.amber()}}>
            DT {row.downtimeRate||0}%
          </span>
          <span style={{fontSize:10,fontWeight:700,color:C.ng()}}>
            RW {row.reworkCount||0}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Section header ────────────────────────────────────────────────────────
const SectionHead = ({ title, right }) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
    marginBottom:16,flexWrap:"wrap",gap:8}}>
    <p style={{fontSize:11,fontWeight:800,textTransform:"uppercase",
      letterSpacing:"0.09em",color:C.txt("muted")}}>{title}</p>
    {right}
  </div>
);

// ── Chart tooltip theme ───────────────────────────────────────────────────
const TooltipStyle = {
  contentStyle:{
    background:C.bg("card"),border:`1px solid ${C.bdr()}`,
    borderRadius:10,fontSize:12,color:C.txt("pri"),
    boxShadow:SHADOW_MD,
  },
  labelStyle:{ color:C.txt("sec"), fontWeight:700 },
  itemStyle:{ color:C.txt("pri") },
};

// ═══════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
const Dashboard = () => {
  injectDS();

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
    dateFrom:"", dateTo:"", machineId:"", partId:"", status:"", shiftCode:"",
  });

  const query = useMemo(()=>({
    dateFrom:   filters.dateFrom   || undefined,
    dateTo:     filters.dateTo     || undefined,
    machineId:  filters.machineId  || undefined,
    partId:     filters.partId     || undefined,
    status:     filters.status     || undefined,
    shiftCode:  filters.shiftCode  || undefined,
  }),[filters]);

  const loadData = useCallback(async()=>{
    try {
      setLoading(true);
      const [m,s,r,o] = await Promise.all([
        machineApi.list(),
        dashboardApi.summary(query),
        dashboardApi.report(query),
        axios.get(`${API_BASE}/dashboard/oee`,{
          headers:{Authorization:`Bearer ${localStorage.getItem("token")}`}
        }).catch(()=>null),
      ]);
      setMachines(m||[]);
      setSummary(s||EMPTY_SUMMARY);
      setReport(r||EMPTY_REPORT);
      if (o) setOeeData(o.data?.oee||[]);
    } catch(e){
      console.error("Dashboard load error",e);
    } finally { setLoading(false); }
  },[query]);

  useEffect(()=>{ loadData(); const t=setInterval(loadData,15000); return()=>clearInterval(t); },[loadData]);
  useEffect(()=>{ const t=setInterval(()=>setNowMs(Date.now()),30000); return()=>clearInterval(t); },[]);

  useEffect(()=>{
    const sock=io(SOCKET_URL,{path:"/socket.io/",transports:["websocket","polling"]});
    sock.on("dashboard_refresh",()=>loadData());
    sock.on("plc_connection_event",d=>{
      if (d.machineId) setPlcMap(p=>({...p,[d.machineId]:d.state==="COMPLETED"||d.state==="CLOSED"}));
    });
    return()=>sock.disconnect();
  },[loadData]);

  const efficiency = useMemo(()=>{
    const t=(summary.quality?.ok||0)+(summary.quality?.ng||0);
    return t>0 ? Math.round((summary.quality.ok/t)*100) : 0;
  },[summary.quality]);

  // Pie data
  const pieData = useMemo(()=>[
    { name:"Pass", value:summary.quality?.ok||0  },
    { name:"Fail", value:summary.quality?.ng||0  },
  ],[summary.quality]);

  // Shift bar data
  const shiftData = useMemo(()=>
    Object.entries(report.shiftProduction||{}).map(([k,v])=>({
      name: k==="SHIFT_A"?"Shift A": k==="SHIFT_B"?"Shift B":"Shift C",
      OK:v.ok||0, NG:v.ng||0,
    }))
  ,[report.shiftProduction]);

  const hasFilters = Object.values(filters).some(Boolean);

  // ── Tabs config ──
  const TABS = [
    { id:"overview",  label:"Overview",          icon:BarChart3  },
    { id:"machines",  label:"Machine KPIs",      icon:Cpu        },
    { id:"oee",       label:"OEE Analysis",      icon:Activity   },
    { id:"history",   label:"Production History",icon:History    },
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,paddingBottom:32,
      animation:"dbFadeIn 0.3s ease"}}>

      {/* ── Alarms ── */}

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div style={{
        background:C.bg("card"),border:`1px solid ${C.bdr()}`,
        borderRadius:16,padding:"18px 20px",boxShadow:SHADOW,overflow:"hidden",
      }}>
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,
          margin:"-18px -20px 16px"}}/>

        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",
          flexWrap:"wrap",gap:12}}>
          {/* Title */}
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:46,height:46,borderRadius:13,
              background:`linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
              display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
              boxShadow:`0 4px 14px ${C.navy(0.35)}`}}>
              <BarChart3 size={22} color={C.linen()}/>
            </div>
            <div>
              <h1 style={{fontSize:18,fontWeight:800,color:C.txt("pri"),
                letterSpacing:"-0.02em",lineHeight:1.2}}>
                Production Overview
              </h1>
              <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
                <div style={{position:"relative",width:8,height:8}}>
                  <div style={{position:"absolute",inset:0,borderRadius:"50%",
                    background:C.ok(),animation:"dbPing 1.6s ease-out infinite",opacity:0.6}}/>
                  <div style={{width:8,height:8,borderRadius:"50%",background:C.ok()}}/>
                </div>
                <p style={{fontSize:12,color:C.txt("muted")}}>
                  Live — auto-refreshes every 15 seconds
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
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

            <button
              onClick={()=>downloadBlob(new Blob(["..."]),`report-${Date.now()}.csv`)}
              style={{
                display:"inline-flex",alignItems:"center",gap:7,
                height:38,padding:"0 16px",borderRadius:9,
                fontSize:12,fontWeight:800,cursor:"pointer",
                background:C.amber(),border:"none",
                color:C.navy(),
                boxShadow:`0 3px 12px ${C.amber(0.3)}`,
                transition:"filter 0.15s",
              }}
              onMouseEnter={e=>e.currentTarget.style.filter="brightness(1.06)"}
              onMouseLeave={e=>e.currentTarget.style.filter="none"}>
              <Download size={14}/> Export Report
            </button>
          </div>
        </div>

        {/* ── Filter bar ── */}
        {showFilters && (
          <div style={{
            marginTop:16,padding:"16px",borderRadius:12,
            background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
            display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,
            animation:"dbFadeIn 0.2s ease",
          }}>
            {/* Date filters */}
            {[
              { key:"dateFrom",  placeholder:"From date",     type:"date"   },
              { key:"dateTo",    placeholder:"To date",       type:"date"   },
            ].map(f=>(
              <input key={f.key} type={f.type}
                placeholder={f.placeholder}
                value={filters[f.key]}
                onChange={e=>setFilters(prev=>({...prev,[f.key]:e.target.value}))}
                style={{
                  height:36,padding:"0 12px",
                  background:C.bg("input"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,fontSize:12,
                  color:C.txt("pri"),outline:"none",
                  fontFamily:"'DM Sans',sans-serif",
                }}
              />
            ))}

            {/* Machine dropdown */}
            <select
              value={filters.machineId}
              onChange={e=>setFilters(prev=>({...prev,machineId:e.target.value}))}
              style={{
                height:36,padding:"0 12px",
                background:C.bg("input"),
                border:`1px solid ${C.bdr()}`,
                borderRadius:8,fontSize:12,
                color:C.txt("pri"),outline:"none",
                fontFamily:"'DM Sans',sans-serif",
                minWidth:140,cursor:"pointer",
                appearance:"auto",
              }}>
              <option value="">All Machines</option>
              {machines.map(m=>(
                <option key={m.id} value={m.id}>{m.machineName}</option>
              ))}
            </select>

            {/* Part serial */}
            <input
              type="text"
              placeholder="Part serial"
              value={filters.partId}
              onChange={e=>setFilters(prev=>({...prev,partId:e.target.value}))}
              style={{
                height:36,padding:"0 12px",
                background:C.bg("input"),
                border:`1px solid ${C.bdr()}`,
                borderRadius:8,fontSize:12,
                color:C.txt("pri"),outline:"none",
                fontFamily:"'DM Sans',sans-serif",
              }}
            />

            {/* Status dropdown */}
            <select
              value={filters.status}
              onChange={e=>setFilters(prev=>({...prev,status:e.target.value}))}
              style={{
                height:36,padding:"0 12px",
                background:C.bg("input"),
                border:`1px solid ${C.bdr()}`,
                borderRadius:8,fontSize:12,
                color:C.txt("pri"),outline:"none",
                fontFamily:"'DM Sans',sans-serif",
                minWidth:120,cursor:"pointer",
                appearance:"auto",
              }}>
              <option value="">All Status</option>
              <option value="OK">Pass (OK)</option>
              <option value="NG">Fail (NG)</option>
              <option value="WIP">In Progress</option>
              <option value="INTERLOCKED">Interlocked</option>
            </select>

            {/* Shift dropdown */}
            <select
              value={filters.shiftCode}
              onChange={e=>setFilters(prev=>({...prev,shiftCode:e.target.value}))}
              style={{
                height:36,padding:"0 12px",
                background:C.bg("input"),
                border:`1px solid ${C.bdr()}`,
                borderRadius:8,fontSize:12,
                color:C.txt("pri"),outline:"none",
                fontFamily:"'DM Sans',sans-serif",
                minWidth:120,cursor:"pointer",
                appearance:"auto",
              }}>
              <option value="">All Shifts</option>
              {(summary.availableShifts||["SHIFT_A","SHIFT_B","SHIFT_C"]).map(s=>(
                <option key={typeof s === 'string' ? s : s.shiftCode} value={typeof s === 'string' ? s : s.shiftCode}>
                  {typeof s === 'string' ? s.replace("_"," ") : (s.shiftName || s.shiftCode)}
                </option>
              ))}
            </select>

            {hasFilters && (
              <button onClick={()=>setFilters({dateFrom:"",dateTo:"",machineId:"",partId:"",status:"",shiftCode:""})}
                style={{height:36,padding:"0 14px",borderRadius:8,
                  background:C.ng(0.08),border:`1px solid ${C.ng(0.25)}`,
                  color:C.ng(),fontSize:12,fontWeight:700,cursor:"pointer"}}>
                Clear Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── KPI Row ────────────────────────────────────────────────────── */}
      <div style={{display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
        <KpiCard label="Total Machines"   value={summary.machines.total}          icon={Cpu}          accent={C.steel()}  sub={`${summary.machines.active} active`}/>
        <KpiCard label="In Progress"      value={summary.parts.inProgress}         icon={Zap}          accent={C.wip()}    sub="Parts being processed"/>
        <KpiCard label="Completed (Pass)" value={summary.parts.completed}          icon={CheckCircle2} accent={C.ok()}     sub="Total OK this period"/>
        <KpiCard label="Failed (NG)"      value={summary.quality?.ng||0}           icon={XCircle}      accent={C.ng()}     sub="Requires attention"/>
        <KpiCard label="Interlocked"      value={summary.parts.interlocked||0}     icon={AlertTriangle}accent={C.amber()}  sub="PLC blocked"/>
        <KpiCard label="Pass Rate"        value={`${efficiency}%`}                 icon={TrendingUp}   accent={efficiency>=85?C.ok():efficiency>=60?C.amber():C.ng()} sub="Overall quality rate"/>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
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

      {/* ── TAB: Overview ──────────────────────────────────────────────── */}
      {activeTab==="overview" && (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Row 1: donut + line chart */}
          <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:16,
            flexWrap:"wrap"}}
            className="db-grid-responsive">
            <style>{`@media(max-width:900px){.db-grid-responsive{grid-template-columns:1fr!important}}`}</style>

            {/* Pass/Fail donut */}
            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title="Pass / Fail Split"/>
              <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
                <div style={{position:"relative",width:160,height:160}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%"
                        innerRadius={50} outerRadius={75}
                        paddingAngle={3} dataKey="value" strokeWidth={0}>
                        <Cell fill={C.ok()} />
                        <Cell fill={C.ng()} />
                      </Pie>
                      <Tooltip {...TooltipStyle}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{position:"absolute",inset:0,display:"flex",
                    flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <p style={{fontSize:22,fontWeight:800,color:C.txt("pri"),
                      fontFamily:"'DM Mono',monospace",lineHeight:1}}>{efficiency}%</p>
                    <p style={{fontSize:10,color:C.txt("muted"),marginTop:2}}>Pass Rate</p>
                  </div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  { label:"Pass", value:summary.quality?.ok||0, color:C.ok() },
                  { label:"Fail", value:summary.quality?.ng||0, color:C.ng() },
                ].map(s=>(
                  <div key={s.label} style={{background:C.bg("surf"),
                    border:`1px solid ${C.bdr()}`,borderRadius:10,
                    padding:"10px 12px",textAlign:"center"}}>
                    <p style={{fontSize:22,fontWeight:800,color:s.color,
                      fontFamily:"'DM Mono',monospace",lineHeight:1}}>{s.value}</p>
                    <p style={{fontSize:10,color:C.txt("muted"),marginTop:4,fontWeight:700,
                      textTransform:"uppercase",letterSpacing:"0.07em"}}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Hourly production line chart */}
            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title="Hourly Production"
                right={
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:C.ok(),
                      animation:"dbPing 1.6s ease-out infinite",opacity:0.7}}/>
                    <span style={{fontSize:11,color:C.ok(),fontWeight:700}}>Live</span>
                  </div>
                }
              />
              <div style={{height:220}}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={report.hourlyProduction}
                    margin={{top:4,right:8,bottom:0,left:-10}}>
                    <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                    <XAxis dataKey="hour"
                      tickFormatter={h=>`${String(h).padStart(2,"0")}:00`}
                      tick={{fontSize:11,fill:C.txt("muted"),fontFamily:"'DM Mono',monospace"}}
                      axisLine={false} tickLine={false}/>
                    <YAxis tick={{fontSize:11,fill:C.txt("muted")}}
                      axisLine={false} tickLine={false}/>
                    <Tooltip {...TooltipStyle}
                      labelFormatter={h=>`${String(h).padStart(2,"0")}:00`}/>
                    <Line type="monotone" dataKey="ok"    stroke={C.ok()}    strokeWidth={2.5}
                      dot={false} activeDot={{r:4,fill:C.ok()}}/>
                    <Line type="monotone" dataKey="ng"    stroke={C.ng()}    strokeWidth={2}
                      dot={false} strokeDasharray="4 3" activeDot={{r:4,fill:C.ng()}}/>
                    <Line type="monotone" dataKey="total" stroke={C.steel()}  strokeWidth={1.5}
                      dot={false} strokeDasharray="2 4"  activeDot={{r:4,fill:C.steel()}}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
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

          {/* Row 2: shift breakdown + recent scans */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}
            className="db-grid-2">
            <style>{`@media(max-width:800px){.db-grid-2{grid-template-columns:1fr!important}}`}</style>

            {/* Shift bar chart */}
            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,padding:20,boxShadow:SHADOW}}>
              <SectionHead title="Production by Shift"/>
              <div style={{height:200}}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={shiftData} margin={{top:4,right:8,bottom:0,left:-10}}>
                    <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false}/>
                    <XAxis dataKey="name" tick={{fontSize:11,fill:C.txt("muted")}}
                      axisLine={false} tickLine={false}/>
                    <YAxis tick={{fontSize:11,fill:C.txt("muted")}}
                      axisLine={false} tickLine={false}/>
                    <Tooltip {...TooltipStyle}/>
                    <Bar dataKey="OK" fill={C.ok()}    radius={[4,4,0,0]}/>
                    <Bar dataKey="NG" fill={C.ng()}    radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent scans */}
            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,overflow:"hidden",boxShadow:SHADOW}}>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.bdr()}`,
                background:C.bg("surf")}}>
                <p style={{fontSize:11,fontWeight:800,textTransform:"uppercase",
                  letterSpacing:"0.09em",color:C.txt("muted")}}>Recent Scans</p>
              </div>
              <div style={{maxHeight:220,overflowY:"auto"}}>
                {(summary.recentScans||[]).length===0 ? (
                  <div style={{padding:"32px 16px",textAlign:"center",
                    color:C.txt("muted"),fontSize:12}}>No recent scans</div>
                ) : (summary.recentScans||[]).slice(0,8).map((sc,i)=>(
                  <div key={i} style={{
                    display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"10px 16px",
                    borderBottom: i<7 ? `1px solid ${C.bdr()}` : "none",
                    background: i%2===1?C.bg("surf"):"transparent",
                  }}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,
                      fontWeight:700,color:C.txt("pri"),
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                      maxWidth:140}}>{sc.partId||"—"}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:10,color:C.txt("muted"),
                        fontFamily:"'DM Mono',monospace"}}>
                        {sc.stationNo||"—"}
                      </span>
                      <Badge variant={sc.result==="OK"?"ok":sc.result==="NG"?"ng":"wip"}
                        label={sc.result==="OK"?"Pass":sc.result==="NG"?"Fail":"In Progress"}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Machine KPIs ──────────────────────────────────────────── */}
      {activeTab==="machines" && (
        <div>
          <div style={{display:"grid",
            gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
            {(report?.machineCards||[]).length===0 ? (
              <div style={{padding:"48px 24px",textAlign:"center",
                color:C.txt("muted"),fontSize:13}}>
                <Cpu size={28} color={C.txt("muted")} style={{margin:"0 auto 12px"}}/>
                <p>No machine data available</p>
              </div>
            ) : (report?.machineCards||[]).map(row=>(
              <MachineCard key={row.machineId} row={row}
                plcOnline={plcMap[row.machineId]!==false} nowMs={nowMs}/>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: OEE Analysis ──────────────────────────────────────────── */}
      {activeTab==="oee" && (
        <div style={{display:"grid",
          gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
          {oeeData.length===0 ? (
            <div style={{padding:"48px 24px",textAlign:"center",
              color:C.txt("muted"),fontSize:13}}>
              <Activity size={28} color={C.txt("muted")} style={{margin:"0 auto 12px"}}/>
              <p>No OEE data available</p>
            </div>
          ) : oeeData.map((row,i)=>(
            <div key={i} style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,padding:20,boxShadow:SHADOW}}>
              {/* Header */}
              <div style={{display:"flex",alignItems:"flex-start",
                justifyContent:"space-between",marginBottom:16}}>
                <div>
                  <p style={{fontSize:14,fontWeight:800,color:C.txt("pri"),marginBottom:3}}>
                    {row.machineName}
                  </p>
                  <p style={{fontSize:11,color:C.txt("muted")}}>{row.shiftCode}</p>
                </div>
                <div style={{width:32,height:32,borderRadius:9,
                  background:C.steel(0.1),border:`1px solid ${C.steel(0.25)}`,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <Activity size={15} color={C.steel()}/>
                </div>
              </div>

              {/* Gauges */}
              <div style={{display:"flex",alignItems:"center",
                justifyContent:"space-around",marginBottom:16}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
                  <OeeGauge value={row.oee} size={80} stroke={8}/>
                  <span style={{fontSize:10,fontWeight:700,color:C.txt("muted"),
                    textTransform:"uppercase",letterSpacing:"0.07em"}}>OEE</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    {label:"Quality",     value:row.quality},
                    {label:"Performance", value:row.performance},
                    {label:"Availability",value:row.availability},
                  ].map(g=>(
                    <div key={g.label} style={{display:"flex",alignItems:"center",gap:8}}>
                      <OeeGauge value={g.value} size={44} stroke={5}/>
                      <span style={{fontSize:10,fontWeight:600,color:C.txt("muted"),
                        width:70}}>{g.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer stats */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,
                paddingTop:12,borderTop:`1px solid ${C.bdr()}`}}>
                {[
                  {label:"Pass",     value:row.ok,              color:C.ok()  },
                  {label:"Total",    value:row.total,            color:C.txt("pri")},
                  {label:"Downtime", value:`${row.downtimeMinutes||0}m`, color:C.amber()},
                ].map(s=>(
                  <div key={s.label} style={{textAlign:"center"}}>
                    <p style={{fontSize:15,fontWeight:800,color:s.color,
                      fontFamily:"'DM Mono',monospace",lineHeight:1}}>{s.value}</p>
                    <p style={{fontSize:9,fontWeight:700,color:C.txt("muted"),
                      textTransform:"uppercase",letterSpacing:"0.07em",marginTop:3}}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TAB: Production History ─────────────────────────────────────── */}
      {activeTab==="history" && (
        <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
          borderRadius:14,overflow:"hidden",boxShadow:SHADOW}}>
          {/* Table header */}
          <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.bdr()}`,
            background:C.bg("surf"),display:"flex",
            alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <History size={15} color={C.steel()}/>
              <p style={{fontSize:12,fontWeight:700,color:C.txt("pri")}}>
                Production History
              </p>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:11,color:C.txt("muted")}}>Records:</span>
              <span style={{fontSize:11,fontWeight:700,color:C.txt("sec"),
                fontFamily:"'DM Mono',monospace"}}>
                {(report?.partJourney||[]).length}
              </span>
            </div>
          </div>

          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                  {["Part Serial","Machine","Station","Result","Timestamp"].map(h=>(
                    <th key={h} style={{padding:"10px 16px",textAlign:"left",
                      fontSize:10,fontWeight:800,textTransform:"uppercase",
                      letterSpacing:"0.08em",color:C.txt("muted"),whiteSpace:"nowrap"}}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(report?.partJourney||[]).length===0 ? (
                  <tr><td colSpan={5}>
                    <div style={{padding:"48px 24px",textAlign:"center",
                      color:C.txt("muted"),fontSize:12}}>
                      No records found
                    </div>
                  </td></tr>
                ) : (report?.partJourney||[]).slice(0,50).map((row,i)=>(
                  <tr key={i} style={{
                    borderBottom:`1px solid ${C.bdr()}`,
                    background:i%2===1?C.bg("surf"):"transparent",
                    transition:"background 0.1s",
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.05)}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.bg("surf"):"transparent"}
                  >
                    <td style={{padding:"10px 16px"}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,
                        fontWeight:700,color:C.txt("pri")}}>
                        {row.part_id||"—"}
                      </span>
                    </td>
                    <td style={{padding:"10px 16px"}}>
                      <p style={{fontSize:12,fontWeight:600,color:C.txt("pri"),marginBottom:2}}>
                        {row.machine_name||"—"}
                      </p>
                      <span style={{fontSize:10,color:C.txt("muted"),
                        fontFamily:"'DM Mono',monospace"}}>
                        {row.station||"—"}
                      </span>
                    </td>
                    <td style={{padding:"10px 16px"}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,
                        color:C.txt("sec")}}>
                        {row.station||"—"}
                      </span>
                    </td>
                    <td style={{padding:"10px 16px"}}>
                      <Badge
                        variant={row.status==="OK"?"ok":row.status==="NG"?"ng":"wip"}
                        label={row.status==="OK"?"Pass":row.status==="NG"?"Fail":"In Progress"}
                      />
                    </td>
                    <td style={{padding:"10px 16px"}}>
                      <span style={{fontSize:11,color:C.txt("muted"),
                        fontFamily:"'DM Mono',monospace"}}>
                        {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;

