import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_OPTIONS, SOCKET_URL } from "../constants/network";
import {
  AlertTriangle,
  CheckCircle,
  Clock3,
  History,
  Route,
  ScanLine,
  Search,
  ShieldAlert,
  XCircle,
  ArrowDownCircle,
  Activity,
  Cpu,
  Fingerprint,
  ChevronRight,
  Zap,
  ShieldCheck,
  Dna,
  Workflow,
  RefreshCw
} from "lucide-react";
import toast from "react-hot-toast";
import { traceabilityApi } from "../api/services";
import { useLanguage } from "../context/LanguageContext";



function eventTypeClass(type) {
  if (type === "SUCCESS") return "text-emerald-400";
  if (type === "ERROR") return "text-red-400";
  if (type === "WARNING") return "text-primary";
  return "text-primary";
}

function normalizeEventType(type, decision) {
  if (type) return String(type).toUpperCase();
  return decision === "ALLOW" ? "SUCCESS" : "WARNING";
}

const Traceability = () => {
  const { t } = useLanguage();
  const [partId, setPartId] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [traceData, setTraceData] = useState(null);
  const [operations, setOperations] = useState([]);
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    traceabilityApi.operations().then((rows) => setOperations(rows)).catch(() => setOperations([]));
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, SOCKET_OPTIONS);
    const pushFeed = (entry) => {
      setFeed((prev) => [{ id: `${Date.now()}-${Math.random()}`, timestamp: new Date().toISOString(), ...entry }, ...prev].slice(0, 25));
    };
    socket.on("scan_event", (payload = {}) => {
      pushFeed({ type: normalizeEventType(payload.type, payload.decision), message: payload.message || payload.reason || "Scan event", partId: payload.partId || null, stationNo: payload.stationNo || null });
    });
    socket.on("operator_popup", (payload = {}) => {
      pushFeed({ type: normalizeEventType(payload.type), message: payload.message || "Operation event", partId: payload.partId || null, stationNo: payload.stationNo || null, machineName: payload.machineName || null });
    });
    return () => socket.disconnect();
  }, []);

  const partSummary = useMemo(() => traceData?.part || null, [traceData]);
  const historyRows = useMemo(() => (traceData?.history || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [traceData]);
  const reworkRows = useMemo(() => traceData?.reworkHistory || [], [traceData]);

  const handleSearch = async (event) => {
    if (event) event.preventDefault();
    const value = partId.trim();
    if (!value) return;
    setLoading(true);
    setStatus({ type: "", message: "" });
    try {
      const response = await traceabilityApi.historyByPart(value);
      setTraceData(response);
      toast.success(t("traceability.pageTitle", "Production Authenticator"));
    } catch (error) {
      setTraceData(null);
      setStatus({ type: "error", message: error.response?.data?.error || "Trace failed: Identity not found in master ledger" });
      toast.error(t("common.ng", "NG"));
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 rise-in">
      {/* Search Hero */}
      <div className="industrial-card p-10 bg-[radial-gradient(ellipse_at_top_right,_var(--app-primary)_0%,_transparent_40%)] relative overflow-hidden ring-1 ring-primary/20 shadow-2xl shadow-primary/10">
        <div className="absolute top-0 right-0 p-10 opacity-5 -translate-y-4 translate-x-4"><Dna size={120} /></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 relative z-10">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-3xl bg-primary/10 border-2 border-primary/30 flex items-center justify-center text-primary shadow-lg shadow-primary/10">
              <Fingerprint size={40} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-text-main tracking-tighter uppercase mb-1">{t("traceability.pageTitle", "Production Authenticator")}</h1>
              <p className="text-text-muted text-sm font-medium tracking-tight">{t("traceability.pageSubtitle", "Decrypting part genealogy & station conformance matrices")}</p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex-1 max-w-2xl relative group">
            <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-text-muted group-focus-within:text-primary transition-colors">
              <Search size={22} />
            </div>
            <input
              required
              value={partId}
              onChange={(e) => setPartId(e.target.value)}
              className="w-full h-16 bg-bg-dark border-2 border-border rounded-2xl pl-14 pr-44 text-xl font-black font-mono text-primary placeholder:text-text-muted/20 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all shadow-inner"
              placeholder={t("traceability.scanPlaceholder", "SCAN PART ID / SERIAL...")}
            />
            <button disabled={loading} type="submit" className="absolute right-2 top-2 bottom-2 px-8 bg-primary text-on-strong font-black uppercase tracking-widest text-xs rounded-xl hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 shadow-xl shadow-primary/20">
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <ScanLine size={16} />}
              {loading ? t("traceability.searching", "SEARCHING") : t("traceability.authenticate", "AUTHENTICATE")}
            </button>
          </form>
        </div>
      </div>

      {status.message && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-4 animate-shake">
          <ShieldAlert className="text-red-400" />
          <p className="text-xs font-black text-red-400 uppercase tracking-widest">{status.message}</p>
        </div>
      )}

      {/* Main Results Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Results Area */}
        <div className="xl:col-span-8 space-y-6">
          {partSummary ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: t("traceability.identityHash", "Identity Hash"), val: partSummary.part_id, icon: Fingerprint, color: "text-primary" },
                { label: t("traceability.ledgerState", "Ledger State"), val: partSummary.status || t("traceability.idle", "IDLE"), icon: ShieldCheck, color: partSummary.status === 'OK' ? 'text-emerald-400' : 'text-red-400' },
                { label: t("traceability.nodePosition", "Node Position"), val: partSummary.current_station || t("traceability.notStarted", "NOT STARTED"), icon: Workflow, color: "text-text-main" },
                { label: t("traceability.signalBypass", "Signal Bypass"), val: partSummary.interlock_reason || t("traceability.nominal", "NOMINAL"), icon: Zap, color: partSummary.interlock_reason ? 'text-primary' : 'text-emerald-400 opacity-40' }
              ].map((k, i) => (
                <div key={i} className="industrial-card p-5 group hover:border-primary/40 transition-all relative overflow-hidden">
                  <div className="absolute right-0 top-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity"><k.icon size={24} /></div>
                  <p className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-2">{k.label}</p>
                  <p className={`text-sm font-black font-mono truncate ${k.color}`}>{k.val}</p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Journey Timeline */}
          <div className="industrial-card p-0 overflow-hidden min-h-[500px]">
            <div className="px-6 py-5 border-b border-border bg-bg-dark/40 flex items-center justify-between">
              <h2 className="text-xs font-black text-text-main uppercase tracking-[0.2em] flex items-center gap-3">
                <History size={16} className="text-primary" /> {t("traceability.lifecycle", "Multi-Station Lifecycle")}
              </h2>
              {historyRows.length > 0 && (
                <span className="text-[10px] font-black text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full uppercase tracking-widest">
                  {historyRows.length} {t("traceability.nodesRecorded", "Nodes Recorded")}
                </span>
              )}
            </div>

            <div className="p-10">
              {historyRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-text-muted/20">
                  <ArrowDownCircle size={80} className="mb-6 opacity-5" />
                  <p className="text-sm font-black uppercase tracking-[0.4em]">{t("traceability.awaitingIdentity", "Awaiting Identity Decryption")}</p>
                </div>
              ) : (
                <div className="relative border-l-4 border-border/40 ml-4 pl-12 space-y-12">
                  {historyRows.map((row, index) => (
                    <div key={row.id} className="relative rise-in" style={{ animationDelay: `${index * 80}ms` }}>
                      {/* Connector Marker */}
                      <div className={`absolute -left-[58px] top-0 w-8 h-8 rounded-full border-4 border-bg-dark flex items-center justify-center ${["OK", "PASS", "SUCCESS", "ALLOW"].includes(String(row.result || "").toUpperCase()) ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]'}`}>
                        {["OK", "PASS", "SUCCESS", "ALLOW"].includes(String(row.result || "").toUpperCase()) ? <CheckCircle size={14} className="text-on-strong" /> : <XCircle size={14} className="text-on-strong" />}
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-bg-dark/20 p-6 rounded-3xl border border-border/40 hover:border-primary/20 transition-all group">
                        <div className="lg:col-span-4">
                          <div className="flex items-center gap-2 mb-2">
                            <p className="text-[10px] font-black font-mono text-text-muted group-hover:text-primary transition-colors">{new Date(row.createdAt).toLocaleTimeString()} - {new Date(row.createdAt).toLocaleDateString()}</p>
                          </div>
                          <h4 className="text-xl font-black text-text-main uppercase tracking-tight">{row.station_no || row.operation_no}</h4>
                          <p className="text-[10px] font-bold text-text-muted mt-1 opacity-60 uppercase">{row.machine_name || "Industrial Logic Machine"}</p>
                        </div>

                        <div className="lg:col-span-8 flex flex-col md:flex-row gap-4 items-center">
                          <div className="flex-1 bg-bg-dark border border-border rounded-2xl p-4 w-full">
                            <div className="flex justify-between items-center mb-2">
                              <p className="text-[9px] font-black text-text-muted uppercase tracking-widest">PLC Context</p>
                              <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-primary" /><span className="text-[9px] font-black text-primary">COMM ACTIVE</span></div>
                            </div>
                            <p className="text-xs font-black text-text-main font-mono">STATUS REGISTER: <span className="text-emerald-400">{row.plc_status || "0x001"}</span></p>
                          </div>

                          <div className={`flex-1 rounded-2xl p-4 w-full border ${row.interlock_reason ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
                            <p className="text-[9px] font-black uppercase tracking-widest mb-2 opacity-60">Interlock Status</p>
                            <div className="flex items-center gap-2">
                              {row.interlock_reason ? (
                                <p className="text-xs font-black text-primary truncate uppercase">{row.interlock_reason}</p>
                              ) : (
                                <div className="flex items-center gap-2 text-emerald-400">
                                  <ShieldCheck size={14} />
                                  <span className="text-[10px] font-black uppercase tracking-widest">PROVANCE ACCREDITED</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* End of Path Decoration */}
                  <div className="absolute -left-[54px] -bottom-1 w-6 h-6 rounded-full bg-border/20 border-2 border-border/40 flex items-center justify-center">
                    <ChevronRight size={12} className="rotate-90 text-text-muted" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {reworkRows.length > 0 && (
            <div className="industrial-card p-6 border-l-8 border-l-amber-500 bg-amber-500/5 ring-1 ring-amber-500/20 animate-pulse-slow">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-primary shadow-lg shadow-amber-500/10">
                  <History size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-text-main uppercase tracking-tight">Divergent Path (Rework Chain)</h3>
                  <p className="text-xs text-amber-500 font-bold uppercase tracking-widest">Non-standard Lifecycle Event Detected</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reworkRows.map((row) => (
                  <div key={row.id} className="bg-bg-dark border border-amber-500/20 p-4 rounded-2xl group hover:border-amber-500/40 transition-all">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[9px] font-black bg-amber-500/10 text-primary px-2 py-1 rounded uppercase">{row.from_station}</span>
                      <ChevronRight size={12} className="text-amber-500/40" />
                      <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded uppercase">{row.to_station}</span>
                    </div>
                    <p className="text-sm font-black text-text-main group-hover:text-primary transition-colors uppercase leading-tight mb-2">{row.reason || "Manual Intervention Override"}</p>
                    <p className="text-[9px] font-black text-text-muted opacity-60 uppercase">{new Date(row.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="xl:col-span-4 space-y-6">
          {/* Standard Logic Bridge */}
          <div className="industrial-card p-0 overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-border bg-bg-dark/40 flex items-center gap-3">
              <Workflow size={16} className="text-primary" />
              <p className="text-xs font-black text-text-main uppercase tracking-[0.2em]">Logic Sequence Map</p>
            </div>
            <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin">
              {operations.map((row) => (
                <div key={row.id || row.machineId} className="group p-4 rounded-2xl bg-bg-dark border border-border hover:border-primary/40 hover:bg-primary/5 transition-all flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-bg-card border-2 border-border flex items-center justify-center text-xs font-black text-text-muted group-hover:text-primary group-hover:border-primary/20 transition-all shadow-inner">
                    {String(row.sequenceNo).padStart(2, '0')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-text-main leading-none truncate mb-1 uppercase tracking-tight group-hover:text-primary transition-colors">{row.machineName}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-text-muted/60 uppercase group-hover:text-text-muted transition-colors">{row.operationNo}</span>
                      <div className="w-1 h-1 rounded-full bg-border" />
                      <span className="text-[9px] font-bold text-primary/40 uppercase group-hover:text-primary transition-colors">{row.lineName || "L-MAIN"}</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-text-muted opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                </div>
              ))}
            </div>
          </div>

          {/* Neural Event Ticker */}
          <div className="industrial-card p-0 overflow-hidden shadow-2xl border-t-4 border-t-emerald-500/40">
            <div className="px-6 py-4 border-b border-border bg-bg-dark/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Activity size={16} className="text-emerald-400" />
                <p className="text-xs font-black text-text-main uppercase tracking-[0.2em]">Neural Interlock Ticker</p>
              </div>
              <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /><span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">LINK ACTIVE</span></div>
            </div>
            <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto scrollbar-thin">
              {feed.map((event) => (
                <div key={event.id} className="p-4 rounded-2xl bg-bg-card/40 border-l-4 border-border hover:bg-bg-dark/40 transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${event.type === 'SUCCESS' ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]' : (event.type === 'ERROR' ? 'bg-red-400 shadow-[0_0_8px_#ef4444]' : 'bg-primary shadow-[0_0_8px_#f59e0b]')}`} />
                      <span className={`text-[10px] font-black uppercase tracking-widest ${eventTypeClass(event.type)}`}>{event.type}</span>
                    </div>
                    <span className="text-[8px] text-text-muted font-mono bg-bg-dark px-1.5 py-0.5 rounded border border-border">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs font-bold text-text-main leading-relaxed mb-2 uppercase tracking-tight">{event.message}</p>
                  <p className="text-[9px] font-black text-primary font-mono bg-primary/5 px-2 py-1 rounded inline-block">{event.partId || "Industrial Proxy"}</p>
                </div>
              ))}
              {feed.length === 0 && (
                <div className="text-center py-20 opacity-20 flex flex-col items-center">
                  <Clock3 size={40} className="mb-4" />
                  <p className="text-[10px] font-black uppercase tracking-[0.3em]">Awaiting Stream Hydration...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Traceability;






