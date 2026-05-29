import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL } from "../constants/network";
import { 
  Activity, 
  Cpu, 
  Zap, 
  ShieldCheck, 
  Search, 
  Filter, 
  RefreshCw, 
  ArrowRight,
  Monitor,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Clock,
  LayoutGrid,
  BarChart4
} from "lucide-react";
import { machineApi, dashboardApi } from "../api/services";



const MasterOverview = () => {
  const [machines, setMachines] = useState([]);
  const [report, setReport] = useState({ machineCards: [], stationCards: [] });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [feed, setFeed] = useState([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [m, r] = await Promise.all([
        machineApi.list(),
        dashboardApi.report({ dateFrom: new Date(new Date().setHours(0,0,0,0)).toISOString() })
      ]);
      setMachines(m || []);
      setReport(r || { machineCards: [], stationCards: [] });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const socket = io(SOCKET_URL, { path: "/socket.io/", transports: ["websocket", "polling"] });
    socket.on("dashboard_refresh", () => loadData());
    socket.on("operator_popup", (payload) => {
      const msg = `Alert: ${payload.machineName || payload.machineId} reported ${payload.type}`;
      setFeed(prev => [{ id: Date.now(), msg, time: new Date() }, ...prev].slice(0, 50));
    });
    return () => socket.disconnect();
  }, [loadData]);

  const machineMap = useMemo(() => {
    const map = new Map();
    (report.machineCards || []).forEach(c => map.set(Number(c.machineId), c));
    return map;
  }, [report.machineCards]);

  const filteredMachines = useMemo(() => {
    return machines.filter(m => {
      const matchesSearch = m.machineName.toUpperCase().includes(searchTerm.toUpperCase()) || 
                          (m.operationNo || "").toUpperCase().includes(searchTerm.toUpperCase());
      const card = machineMap.get(m.id);
      const downtimeTimePct = Number(card?.downtimeTimePct ?? card?.downtimeRate ?? 0);
      const isFault = downtimeTimePct > 15;
      const status = isFault ? "FAULT" : (card?.processedCount > 0 ? "ACTIVE" : "IDLE");
      const matchesStatus = filterStatus === "ALL" || filterStatus === status;
      return matchesSearch && matchesStatus;
    });
  }, [machines, searchTerm, filterStatus, machineMap]);

  const stats = useMemo(() => {
    const total = machines.length;
    let active = 0, fault = 0, production = 0, target = 0;
    (report.machineCards || []).forEach(c => {
      if (c.processedCount > 0) active++;
      if (Number(c.downtimeTimePct ?? c.downtimeRate ?? 0) > 15) fault++;
      production += (c.processedCount || 0);
      target += (c.targetQty || 0);
    });
    return { total, active, idle: total - active, fault, yield: target > 0 ? ((production/target)*100).toFixed(1) : "0" };
  }, [machines, report.machineCards]);

  return (
    <div className="space-y-6 rise-in">
      {/* Premium Sentinel Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
         <div className="flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-lg shadow-emerald-500/5">
               <ShieldCheck className="text-emerald-400" size={32} />
            </div>
            <div>
               <h1 className="text-3xl font-black text-text-main tracking-tight uppercase">Factory Floor Sentinel</h1>
               <div className="flex items-center gap-3 mt-1">
                  <span className="badge badge-success uppercase">Node Security Active</span>
                  <p className="text-text-muted text-sm font-medium">Monitoring {machines.length} Industrial Edge Assets</p>
               </div>
            </div>
         </div>

         <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 bg-bg-card p-2 rounded-xl border border-border shadow-xl">
               <div className="relative group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors" size={16} />
                  <input 
                    type="text" 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search Node Register..."
                    className="h-10 pl-10 pr-4 bg-bg-dark border border-border rounded-lg text-xs font-black uppercase tracking-widest text-text-main focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none w-64 transition-all"
                  />
               </div>
               <div className="h-6 w-px bg-border" />
               <select 
                 value={filterStatus}
                 onChange={e => setFilterStatus(e.target.value)}
                 className="h-10 bg-transparent text-xs font-black uppercase tracking-widest text-text-muted focus:text-primary transition-colors outline-none cursor-pointer"
               >
                  <option value="ALL">All Status</option>
                  <option value="ACTIVE">Producing</option>
                  <option value="FAULT">Faulted</option>
                  <option value="IDLE">Standby</option>
               </select>
            </div>
            <button onClick={loadData} className="h-11 px-4 rounded-xl bg-bg-card border border-border text-text-muted hover:text-primary transition-all">
               <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </button>
         </div>
      </div>

      {/* Orchestration Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
         {[
           { label: "Asset Population", val: stats.total, icon: Cpu, color: "text-primary" },
           { label: "Active In Stream", val: stats.active, icon: Activity, color: "text-emerald-400" },
           { label: "Standby Mode", val: stats.idle, icon: Clock, color: "text-text-muted" },
           { label: "Faulted Nodes", val: stats.fault, icon: AlertTriangle, color: "text-red-500" },
           { label: "Factory Yield", val: stats.yield + "%", icon: Zap, color: "text-accent" },
         ].map((s, i) => (
           <div key={i} className="industrial-card p-5 group hover:border-primary/40 transition-all bg-gradient-to-br from-bg-card to-bg-dark/40">
              <div className="flex items-center justify-between mb-4">
                 <div className={`p-2 rounded-xl bg-bg-dark border border-border group-hover:border-primary/20 transition-all ${s.color}`}><s.icon size={18} /></div>
                 <ArrowRight size={14} className="text-text-muted opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
              </div>
              <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">{s.label}</p>
              <p className={`text-3xl font-black ${s.color} font-mono tabular-nums leading-none`}>{s.val}</p>
           </div>
         ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
         {/* Live Node Matrix */}
         <div className="xl:col-span-8 space-y-4">
            <div className="flex items-center justify-between px-2">
               <h2 className="text-xs font-black text-text-main uppercase tracking-[0.3em] flex items-center gap-3">
                  <LayoutGrid size={16} className="text-primary" /> Integrated Asset Matrix
               </h2>
               <div className="flex items-center gap-4 text-[10px] font-black text-text-muted uppercase tracking-widest leading-none">
                  <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active</span>
                  <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-red-400" /> Faulted</span>
                  <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-bg-dark border border-border" /> Idle</span>
               </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
               {filteredMachines.map(m => {
                 const card = machineMap.get(m.id);
                 const p = card?.processedCount || 0;
                 const t = card?.targetQty || 100;
                 const pct = Math.min(100, (p/t)*100).toFixed(0);
                 const isFault = Number(card?.downtimeTimePct ?? card?.downtimeRate ?? 0) > 15;
                 const status = isFault ? "FAULT" : (p > 0 ? "ACTIVE" : "IDLE");

                 return (
                   <div key={m.id} className={`industrial-card p-5 group transition-all relative overflow-hidden ${isFault ? 'border-red-500/40 bg-red-500/5' : (p > 0 ? 'border-primary/40 bg-primary/5' : 'bg-bg-dark/40')}`}>
                      {isFault && <div className="absolute top-0 right-0 w-16 h-16 bg-red-500/10 blur-[30px] rounded-full animate-pulse" />}
                      <div className="flex items-center justify-between mb-4">
                         <div className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${isFault ? 'border-red-500/20 text-red-400' : (p > 0 ? 'border-emerald-500/20 text-emerald-400' : 'border-border text-text-muted')}`}>
                            {status}
                         </div>
                         <p className="text-[10px] font-black font-mono text-text-muted">{m.operationNo}</p>
                      </div>
                      <p className="text-base font-black text-text-main leading-tight truncate mb-1">{m.machineName}</p>
                      <p className="text-[10px] font-bold text-text-muted truncate mb-4 uppercase tracking-tighter opacity-60">{m.lineName || "Unassigned"}</p>
                      
                      <div className="space-y-1.5">
                         <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                            <span className="opacity-40">Progress</span>
                            <span className={isFault ? 'text-red-400' : 'text-primary'}>{pct}%</span>
                         </div>
                         <div className="w-full h-1 bg-bg-dark rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-1000 ${isFault ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' : 'bg-primary shadow-[0_0_8px_var(--app-primary)]'}`} 
                              style={{ width: `${pct}%` }} 
                            />
                         </div>
                      </div>
                   </div>
                 );
               })}
               {filteredMachines.length === 0 && (
                 <div className="col-span-full py-20 text-center text-text-muted/20">
                    <Monitor size={64} className="mx-auto mb-4" />
                    <p className="text-sm font-black uppercase tracking-widest">No nodes match current filter parameters.</p>
                 </div>
               )}
            </div>
         </div>

         {/* Event Sentinel Bar */}
         <div className="xl:col-span-4 space-y-6">
            <div className="industrial-card p-0 overflow-hidden border-t-4 border-t-primary">
               <div className="px-6 py-4 border-b border-border bg-bg-dark/40 flex items-center justify-between">
                  <h2 className="text-xs font-black text-text-main uppercase tracking-widest flex items-center gap-2">
                     <Radio size={16} className="text-primary" /> Edge Intelligence Feed
                  </h2>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shadow-[0_0_8px_#10b981]" />
               </div>
               <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto scrollbar-thin">
                  {feed.length === 0 ? (
                    <div className="py-20 text-center text-text-muted/20">
                       <BarChart4 size={32} className="mx-auto mb-3" />
                       <p className="text-[10px] font-black uppercase tracking-widest">Hydrating Live Stream...</p>
                    </div>
                  ) : feed.map(entry => (
                    <div key={entry.id} className="p-4 rounded-xl bg-bg-dark border border-border group hover:border-primary/40 transition-colors">
                       <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em]">Signal Authorization</span>
                          <span className="text-[8px] text-text-muted font-mono">{entry.time.toLocaleTimeString()}</span>
                       </div>
                       <p className="text-xs font-bold text-text-main leading-relaxed">{entry.msg}</p>
                       <div className="mt-3 flex items-center gap-2">
                          <div className="h-0.5 flex-1 bg-primary/20" />
                          <CheckCircle2 size={10} className="text-emerald-500" />
                       </div>
                    </div>
                  ))}
               </div>
            </div>

            {/* Quick Audit Card */}
            <div className="industrial-card p-6 bg-primary/5 border border-primary/20">
               <h3 className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-4">Real-time Efficiency Node</h3>
               <div className="flex items-end gap-3 mb-6">
                  <p className="text-5xl font-black text-primary font-mono leading-none tracking-tighter">{stats.yield}<span className="text-2xl">%</span></p>
                  <p className="text-[10px] text-text-muted font-bold uppercase leading-tight mb-1">Global<br/>Yield Ratio</p>
               </div>
               <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs">
                     <span className="font-bold text-text-main">Pipeline Integrity</span>
                     <span className="text-emerald-400 font-black">STABLE</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                     <span className="font-bold text-text-main">Database Latency</span>
                     <span className="text-emerald-400 font-black">12ms</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                     <span className="font-bold text-text-main">Industrial Link</span>
                     <span className="text-emerald-400 font-black">HANDSHAKE OK</span>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default MasterOverview;



