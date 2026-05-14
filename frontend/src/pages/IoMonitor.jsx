// ============================================================
//  IoMonitor.jsx — IndusTrace v3
//  NEW: "PLC Overview" tab — all PLC IPs, protocol, register
//       range, connection status, test popup
//  Signals as cards, inline write, step-by-step control
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, CheckCircle2, RefreshCw, RotateCcw,
  Save, History, Cpu, Unplug, Zap, Radio, ShieldAlert,
  Wifi, WifiOff, Clock, Signal, Settings, Edit3, Send,
  ChevronDown, ChevronUp, Server, Play, X, List,
} from "lucide-react";
import toast from "react-hot-toast";
import { machineApi, traceabilityApi } from "../api/services";
import { getUserRole } from "../utils/authStorage";
import ConfirmModal from "../components/ConfirmModal";

// ── Design tokens ──────────────────────────────────────────────────────────
const DS = `
  @keyframes ioSpin   { to{transform:rotate(360deg)} }
  @keyframes ioFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes ioPulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
  @keyframes ioPing   { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.4);opacity:0} }
  :root{
    --io-navy:  26,50,99;  --io-steel: 84,119,146;
    --io-amber: 250,185,91; --io-linen: 232,226,219;
    --io-ok:    34,197,94;  --io-ng:    239,68,68;
    --io-wip:   249,115,22; --io-idle:  148,163,184;
  }
  [data-theme="light"]{
    --io-bg-card:   255,255,255; --io-bg-surf:   240,236,230;
    --io-bg-input:  255,255,255; --io-txt-pri:   26,50,99;
    --io-txt-sec:   84,119,146;  --io-txt-muted: 140,160,180;
    --io-bdr: 84,119,146; --io-bop: 0.14;
  }
  [data-theme="dark"]{
    --io-bg-card:   20,34,62;  --io-bg-surf:  16,26,50;
    --io-bg-input:  14,22,44;  --io-txt-pri:  232,226,219;
    --io-txt-sec:   120,160,190; --io-txt-muted: 84,119,146;
    --io-bdr: 84,119,146; --io-bop: 0.18;
  }
`;
let _ioDS = false;
function injectDS() {
  if (_ioDS || typeof document === "undefined") return;
  _ioDS = true;
  const el = document.createElement("style");
  el.textContent = DS;
  document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme", "dark");
}

const C = {
  navy:  (o=1) => `rgba(var(--io-navy),${o})`,
  steel: (o=1) => `rgba(var(--io-steel),${o})`,
  amber: (o=1) => `rgba(var(--io-amber),${o})`,
  linen: (o=1) => `rgba(var(--io-linen),${o})`,
  ok:    (o=1) => `rgba(var(--io-ok),${o})`,
  ng:    (o=1) => `rgba(var(--io-ng),${o})`,
  wip:   (o=1) => `rgba(var(--io-wip),${o})`,
  idle:  (o=1) => `rgba(var(--io-idle),${o})`,
  bg:    (v="card") => `rgb(var(--io-bg-${v}))`,
  txt:   (v="pri")  => `rgb(var(--io-txt-${v}))`,
  bdr:   (o)        => `rgba(var(--io-bdr),${o||"var(--io-bop)"})`,
};
const SH  = `0 2px 12px rgba(var(--io-navy),.08),0 1px 3px rgba(var(--io-navy),.05)`;
const SHM = `0 8px 28px rgba(var(--io-navy),.2),0 3px 8px rgba(var(--io-navy),.1)`;
const SNAPSHOT_POLL_INTERVAL_MS = 10000;

// ── Helpers ────────────────────────────────────────────────────────────────
function normalizeIp(v)   { return String(v||"").replace("::ffff:","").trim(); }
function toIntOrNull(v)   { const n=Number(v); return Number.isFinite(n)?Math.trunc(n):null; }
function normalizeRole(v) { return String(v||"").trim().toLowerCase(); }
function fmtTime(v)  { if(!v) return "—"; const d=new Date(v); return isNaN(d)?"—":d.toLocaleTimeString(); }
function fmtDT(v)    { if(!v) return "—"; const d=new Date(v); return isNaN(d)?"—":d.toLocaleString(); }
function parseSlmpRegisterInput(value, defaultDevice = "D") {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return { register: null, device: String(defaultDevice || "D").toUpperCase() };
  const match = raw.match(/^([A-Z]+)?\s*(\d+)$/);
  if (!match) return { register: null, device: String(defaultDevice || "D").toUpperCase() };
  const reg = Number(match[2]);
  if (!Number.isFinite(reg)) return { register: null, device: String(defaultDevice || "D").toUpperCase() };
  return {
    register: Math.trunc(reg),
    device: String(match[1] || defaultDevice || "D").toUpperCase(),
  };
}
function normalizeDirectionShort(direction) {
  const v = String(direction || "").trim().toUpperCase();
  if (v === "PC -> PLC" || v === "PC_TO_PLC" || v === "PC->PLC" || v === "WRITE") return "WRITE";
  if (v === "BIDIRECTIONAL" || v === "BOTH") return "BIDIRECTIONAL";
  return "READ";
}
function buildIoLiveSpecText({ machine, snapshot, rows }) {
  const m = machine || {};
  const s = snapshot || {};
  const protocol = String(s?.plc?.protocol || m?.plcProtocol || "TCP_TEXT").toUpperCase();
  const ip = s?.plc?.ip || m?.plcIp || "-";
  const port = s?.plc?.port || m?.plcPort || "-";
  const slmpDevice = m?.plcSlmpDevice || m?.plcConfig?.slmpDevice || "D";
  const slmpFrameMode = m?.plcSlmpFrameMode || m?.plcConfig?.slmpFrameMode || "AUTO";
  const lines = [];
  lines.push(`MACHINE: ${String(m?.machineName || "-")}`);
  lines.push(`LINE: ${String(m?.lineName || "-")}`);
  lines.push(`OPERATION: ${String(m?.operationNo || m?.stationNo || "-")}`);
  lines.push(`GENERATED_AT: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("PLC CONNECTION:");
  lines.push(`  protocol=${protocol}`);
  lines.push(`  ip=${ip}`);
  lines.push(`  port=${port}`);
  if (protocol === "SLMP") {
    lines.push(`  slmpDevice=${slmpDevice}`);
    lines.push(`  slmpFrameMode=${slmpFrameMode}`);
  }
  lines.push("");
  lines.push("MAPPED REGISTERS (with current live values):");
  if (!Array.isArray(rows) || rows.length === 0) {
    lines.push("  (no rows)");
  } else {
    for (const row of rows) {
      const reg = toIntOrNull(row?.register);
      if (reg === null) continue;
      const device = String(row?.device || slmpDevice || "D").toUpperCase();
      const direction = normalizeDirectionShort(row?.direction);
      const current = row?.currentValue === null || row?.currentValue === undefined ? "N/A" : String(row.currentValue);
      const label = String(row?.signal || row?.signalKey || `REG_${reg}`).trim();
      const status = String(row?.status || "-").trim();
      const desc = String(row?.description || "").trim();
      lines.push(
        `  register=${reg} (${device}${reg})  label="${label}"  direction=${direction}  currentValue=${current}  status=${status}${desc ? `  purpose="${desc}"` : ""}`
      );
    }
  }
  lines.push("");
  lines.push("CORE SETTINGS:");
  lines.push(
    `  startRegister=${m?.plcConfig?.startRegister ?? m?.plcStartRegister ?? "-"}  statusRegister=${m?.plcConfig?.statusRegister ?? m?.plcStatusRegister ?? "-"}  resetRegister=${m?.plcConfig?.resetRegister ?? m?.plcResetRegister ?? "-"}`
  );
  lines.push(
    `  startValue=${m?.plcConfig?.startValue ?? m?.plcStartValue ?? 1}  startedValue=${m?.plcConfig?.startedValue ?? m?.plcStartedValue ?? 2}  endOkValue=${m?.plcConfig?.endOkValue ?? m?.plcEndOkValue ?? 3}  endNgValue=${m?.plcConfig?.endNgValue ?? m?.plcEndNgValue ?? 4}  blockValue=${m?.plcConfig?.blockValue ?? m?.plcBlockValue ?? 2}  resetValue=${m?.plcConfig?.resetValue ?? m?.plcResetValue ?? 9}`
  );
  return lines.join("\n");
}
function toErr(e,fb) {
  const st=Number(e?.response?.status||0);
  if (st===401||st===403) return "Access denied. Admin or Engineer role required.";
  const m=String(e?.response?.data?.error||fb||"").trim();
  if (/CONNECT.TIMEOUT|ECONNREFUSED/i.test(m)) return `${m} — Check IP/Port and network.`;
  return m||fb||"An error occurred.";
}
function getSignalColor(tone, val) {
  const t=String(tone||"").toLowerCase();
  if (t==="good")  return {fg:C.ok(),   bg:C.ok(0.1),   bd:C.ok(0.3)   };
  if (t==="error") return {fg:C.ng(),   bg:C.ng(0.1),   bd:C.ng(0.3)   };
  if (t==="warn")  return {fg:C.wip(),  bg:C.wip(0.1),  bd:C.wip(0.3)  };
  if (val===1)     return {fg:C.ok(),   bg:C.ok(0.08),  bd:C.ok(0.2)   };
  if (val===0)     return {fg:C.idle(), bg:C.idle(0.06),bd:C.idle(0.15)};
  return                  {fg:C.steel(),bg:C.steel(0.08),bd:C.steel(0.2)};
}

// ── Shared atoms ───────────────────────────────────────────────────────────
const Badge = ({ variant="idle", label, pulse }) => {
  const map = {
    ok:    {fg:C.ok(),   bg:C.ok(0.1),   bd:C.ok(0.25)  },
    ng:    {fg:C.ng(),   bg:C.ng(0.1),   bd:C.ng(0.25)  },
    wip:   {fg:C.wip(),  bg:C.wip(0.1),  bd:C.wip(0.25) },
    idle:  {fg:C.idle(), bg:C.idle(0.08),bd:C.idle(0.2) },
    steel: {fg:C.steel(),bg:C.steel(0.1),bd:C.steel(0.25)},
    amber: {fg:C.amber(),bg:C.amber(0.12),bd:C.amber(0.3)},
  };
  const s=map[variant]||map.idle;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,
      padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700,
      letterSpacing:"0.04em",color:s.fg,background:s.bg,
      border:`1px solid ${s.bd}`,whiteSpace:"nowrap"}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:s.fg,flexShrink:0,
        animation:pulse?"ioPulse 1.2s ease-in-out infinite":"none"}}/>
      {label}
    </span>
  );
};

const Btn = ({ children, onClick, disabled, loading, variant="ghost", size="md", full, style:sx={} }) => {
  const [h,setH]=useState(false);
  const V={
    ghost:  {bg:h?C.bg("surf"):"transparent",  color:C.txt("sec"),  border:`1px solid ${C.bdr()}`},
    navy:   {bg:h?C.navy(0.85):C.navy(),        color:C.linen(),     border:"none"},
    amber:  {bg:h?C.amber(0.9):C.amber(),       color:C.navy(),      border:"none",fontWeight:800,boxShadow:`0 3px 10px ${C.amber(0.25)}`},
    ok:     {bg:h?C.ok(0.18):C.ok(0.1),         color:C.ok(),        border:`1px solid ${C.ok(0.3)}`},
    danger: {bg:h?C.ng(0.18):C.ng(0.1),         color:C.ng(),        border:`1px solid ${C.ng(0.3)}`},
    steel:  {bg:h?C.steel(0.2):C.steel(0.1),    color:C.steel(),     border:`1px solid ${C.steel(0.3)}`},
  };
  const s=V[variant]||V.ghost;
  const H=size==="sm"?32:size==="lg"?44:38;
  return (
    <button onClick={onClick} disabled={disabled||loading}
      onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,
        height:H,padding:size==="sm"?"0 12px":size==="lg"?"0 22px":"0 16px",
        width:full?"100%":undefined,
        borderRadius:8,fontSize:size==="sm"?11:12,fontWeight:700,
        cursor:disabled||loading?"not-allowed":"pointer",
        opacity:disabled||loading?0.45:1,
        transition:"all .15s",...s,...sx}}>
      {loading ? <RefreshCw size={12} style={{animation:"ioSpin .9s linear infinite"}}/> : children}
    </button>
  );
};

const inp = (focus) => ({
  height:38,padding:"0 11px",background:C.bg("input"),
  border:`1px solid ${focus?C.steel():C.bdr()}`,
  borderRadius:8,fontSize:12,color:C.txt("pri"),outline:"none",
  fontFamily:"'DM Sans',sans-serif",transition:"border-color .15s,box-shadow .15s",
  boxShadow:focus?`0 0 0 3px ${C.steel(0.1)}`:"none",
  width:"100%",boxSizing:"border-box",
});

const Label = ({children,required})=>(
  <p style={{fontSize:10,fontWeight:800,textTransform:"uppercase",
    letterSpacing:"0.08em",color:C.txt("muted"),marginBottom:5,
    display:"flex",alignItems:"center",gap:3}}>
    {children}{required&&<span style={{color:C.ng()}}>*</span>}
  </p>
);

const SCard = ({title,subtitle,accent,right,children,noPad})=>(
  <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
    borderRadius:14,overflow:"hidden",boxShadow:SH,
    borderLeft:accent?`3px solid ${accent}`:"none"}}>
    {(title||right)&&(
      <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.bdr()}`,
        background:C.bg("surf"),display:"flex",alignItems:"center",
        justifyContent:"space-between",gap:8}}>
        <div>
          {subtitle&&<p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
            letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:1}}>{subtitle}</p>}
          {title&&<p style={{fontSize:13,fontWeight:700,color:C.txt("pri")}}>{title}</p>}
        </div>
        {right}
      </div>
    )}
    <div style={noPad?{}:{padding:18}}>{children}</div>
  </div>
);

// ── Signal Card ───────────────────────────────────────────────────────────
const SignalCard = ({ row, onWrite, canWrite, writing }) => {
  const [showWrite,setShowWrite]=useState(false);
  const [writeVal, setWriteVal] =useState("");
  const [focus,    setFocus]    =useState(false);
  const val   = row.currentValue??0;
  const sc    = getSignalColor(row.tone, val);
  const isHigh = val===1;

  return (
    <div style={{background:C.bg("card"),border:`1px solid ${sc.bd}`,
      borderRadius:12,overflow:"hidden",boxShadow:SH,transition:"box-shadow .15s,border-color .15s"}}>
      {/* Header */}
      <div style={{padding:"12px 14px 10px",borderBottom:`1px solid ${C.bdr()}`,background:sc.bg}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:6}}>
          <div style={{minWidth:0}}>
            <p style={{fontSize:12,fontWeight:800,color:C.txt("pri"),lineHeight:1.2,marginBottom:3,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {row.signal||"Signal"}
            </p>
            <p style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:C.steel(),fontWeight:600}}>
              Reg: {row.register||"—"}
              {row.direction&&<span style={{marginLeft:8,color:C.txt("muted")}}>{row.direction}</span>}
            </p>
          </div>
          {row.writable&&(
            <span style={{fontSize:9,fontWeight:700,color:C.amber(),textTransform:"uppercase",
              letterSpacing:"0.06em",padding:"2px 6px",borderRadius:4,
              background:C.amber(0.1),border:`1px solid ${C.amber(0.25)}`,flexShrink:0}}>
              Writable
            </span>
          )}
        </div>
      </div>
      {/* Value */}
      <div style={{padding:"14px",display:"flex",alignItems:"center",
        justifyContent:"space-between",gap:10}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontSize:42,fontWeight:900,lineHeight:1,
            fontFamily:"'DM Mono',monospace",color:sc.fg,
            textShadow:isHigh?`0 0 20px ${sc.fg}`:"none",
            transition:"color .3s,text-shadow .3s"}}>
            {val}
          </span>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",
              letterSpacing:"0.07em",color:sc.fg}}>
              {isHigh?"ON":val===0?"OFF":"—"}
            </span>
            <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:C.txt("muted")}}>
              {row.status || "—"}
            </span>
            {row.description&&(
              <span style={{fontSize:10,color:C.txt("muted"),maxWidth:120,lineHeight:1.3,
                display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
                {row.description}
              </span>
            )}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
          <Badge
            variant={row.tone==="good"?"ok":row.tone==="error"?"ng":row.tone==="warn"?"wip":isHigh?"ok":val===0?"idle":"wip"}
            label={row.tone==="good"?"Active":row.tone==="error"?"Fault":row.tone==="warn"?"Warning":isHigh?"Active":"Idle"}
            pulse={isHigh}
          />
          {row.writable&&canWrite&&(
            <button onClick={()=>setShowWrite(p=>!p)}
              style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,
                fontWeight:700,color:C.steel(),background:"none",border:"none",
                cursor:"pointer",padding:"3px 0",transition:"color .15s"}}
              onMouseEnter={e=>e.currentTarget.style.color=C.amber()}
              onMouseLeave={e=>e.currentTarget.style.color=C.steel()}>
              <Edit3 size={11}/>
              {showWrite?"Cancel":"Write"}
              {showWrite?<ChevronUp size={10}/>:<ChevronDown size={10}/>}
            </button>
          )}
        </div>
      </div>
      {/* Inline write */}
      {showWrite&&row.writable&&canWrite&&(
        <div style={{padding:"10px 14px 12px",borderTop:`1px solid ${C.bdr()}`,
          background:C.bg("surf"),animation:"ioFadeIn .15s ease"}}>
          <p style={{fontSize:10,fontWeight:700,color:C.txt("muted"),marginBottom:7}}>
            Write value to register {row.register}
          </p>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {[0,1,9].map(p=>(
              <button key={p} onClick={()=>setWriteVal(String(p))}
                style={{width:36,height:34,borderRadius:7,fontSize:13,fontWeight:800,cursor:"pointer",
                  background:writeVal===String(p)?C.amber(0.15):"transparent",
                  border:`1px solid ${writeVal===String(p)?C.amber(0.4):C.bdr()}`,
                  color:writeVal===String(p)?C.amber():C.txt("muted"),transition:"all .12s"}}>
                {p}
              </button>
            ))}
            <input value={writeVal} onChange={e=>setWriteVal(e.target.value)}
              placeholder="value"
              onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
              style={{...inp(focus),flex:1,fontFamily:"'DM Mono',monospace",textAlign:"center"}}/>
            <Btn variant="amber" size="sm" loading={writing}
              disabled={writeVal===""||writing}
              onClick={()=>{
                const v=toIntOrNull(writeVal);
                if (v===null){toast.error("Enter a number");return;}
                onWrite(row,v,()=>{setShowWrite(false);setWriteVal("");});
              }}>
              <Send size={12}/> Send
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
};

// ── ConnCard ──────────────────────────────────────────────────────────────
const ConnCard = ({ connected, label, sublabel, protocol }) => (
  <div style={{background:C.bg("card"),
    border:`1px solid ${connected?C.ok(0.3):C.ng(0.3)}`,
    borderLeft:`3px solid ${connected?C.ok():C.ng()}`,
    borderRadius:12,padding:"14px 16px",boxShadow:SH,
    display:"flex",alignItems:"center",gap:12}}>
    <div style={{position:"relative",width:38,height:38,flexShrink:0}}>
      {connected&&(
        <div style={{position:"absolute",inset:0,borderRadius:"50%",
          background:C.ok(0.25),animation:"ioPing 1.8s ease-out infinite"}}/>
      )}
      <div style={{width:38,height:38,borderRadius:"50%",position:"relative",
        background:connected?C.ok(0.12):C.ng(0.1),
        border:`1.5px solid ${connected?C.ok(0.4):C.ng(0.3)}`,
        display:"flex",alignItems:"center",justifyContent:"center"}}>
        {connected?<Wifi size={17} color={C.ok()}/>:<WifiOff size={17} color={C.ng()}/>}
      </div>
    </div>
    <div style={{flex:1,minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
        <p style={{fontSize:13,fontWeight:800,color:C.txt("pri")}}>{label}</p>
        <Badge variant={connected?"ok":"ng"} label={connected?"Connected":"Disconnected"} pulse={connected}/>
      </div>
      <p style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:C.txt("muted")}}>
        {sublabel}
        {protocol&&<span style={{marginLeft:8,fontWeight:700,color:C.steel()}}>{protocol}</span>}
      </p>
    </div>
  </div>
);

// ── PLC Test Modal ────────────────────────────────────────────────────────
const PlcTestModal = ({ plc, onClose }) => {
  const [testing,   setTesting]   = useState(false);
  const [result,    setResult]    = useState(null);
  const [register,  setRegister]  = useState("");
  const [testVal,   setTestVal]   = useState("0");
  const [focus,     setFocus]     = useState("");

  const isMitsu = (plc.protocol||"").toUpperCase().includes("SLMP") ||
                  (plc.protocol||"").toUpperCase().includes("MITSUBISHI");

  useEffect(()=>{
    setRegister(plc.testRegister || (isMitsu ? "D100" : String(plc.startRegister||40001)));
    setTestVal("0");
  },[plc,isMitsu]);

  const runTest = async () => {
    setTesting(true); setResult(null);
    const t0 = Date.now();
    let parsedWriteValue = null;
    try {
      const timeoutMs = Math.min(Math.max(toIntOrNull(plc?.plcTestTimeoutMs) || 5000, 1000), 8000);
      const retryCount = Math.max(toIntOrNull(plc?.plcTestRetryCount) || 2, 1);
      parsedWriteValue = toIntOrNull(testVal);
      if (parsedWriteValue === null) {
        throw new Error("Enter a valid numeric test value");
      }

      const payload = { machineId: plc.machineId };
      payload.plcTestTimeoutMs = timeoutMs;
      payload.plcTestRetryCount = retryCount;
      payload.plcSlmpFrameMode = plc.slmpFrameMode || "AUTO";
      let writeReq = null;
      let writeRes = null;
      if (isMitsu) {
        const parsed = parseSlmpRegisterInput(register, plc.slmpDevice || "D");
        if (parsed.register === null) {
          throw new Error("Enter SLMP register like D100");
        }
        payload.plcStatusRegister = parsed.register;
        payload.plcSlmpDevice = parsed.device;
        writeReq = {
          machineId: plc.machineId,
          registerNo: parsed.register,
          value: parsedWriteValue,
          plcSlmpDevice: parsed.device,
          plcSlmpFrameMode: plc.slmpFrameMode || "AUTO",
          timeoutMs,
          retryCount,
        };
      } else {
        const regNo = toIntOrNull(register);
        if (regNo === null) {
          throw new Error("Enter numeric register address");
        }
        payload.plcStatusRegister = regNo;
        writeReq = {
          machineId: plc.machineId,
          registerNo: regNo,
          value: parsedWriteValue,
          timeoutMs,
          retryCount,
        };
      }
      writeRes = await machineApi.writePlcValue(writeReq, { timeout: 15000 });
      const res = await machineApi.testPlc(payload, { timeout: 15000 });
      const readValue = res?.probe?.statusValue;
      const readOk = Number.isFinite(Number(readValue)) ? Number(readValue) === parsedWriteValue : false;
      setResult({
        success: readOk,
        message: readOk
          ? `Write+Read successful. Sent ${parsedWriteValue}, received ${readValue}.`
          : `Write sent ${parsedWriteValue}, but read-back is ${readValue ?? "N/A"}.`,
        latency: Date.now()-t0,
        request: { write: writeReq, read: payload },
        probe: { write: writeRes?.write || null, read: res?.probe || null },
      });
    } catch(e) {
      setResult({
        success: false,
        message: toErr(e, "Read/Write test failed. Check IP, port, SLMP route/device, and register."),
        latency: Date.now()-t0,
        request: {
          machineId: plc.machineId,
          register,
          testVal: parsedWriteValue ?? testVal,
          protocol: plc.protocol || null,
          timeoutMs: Math.max(toIntOrNull(plc?.plcTestTimeoutMs) || 8000, 1000),
          retryCount: Math.max(toIntOrNull(plc?.plcTestRetryCount) || 3, 1),
        },
        error: e?.response?.data?.error || e?.message || null,
      });
    } finally { setTesting(false); }
  };

  const inpM = (f) => ({...inp(focus===f), height:38});

  return (
    <div style={{position:"fixed",inset:0,zIndex:1200,
      display:"flex",alignItems:"center",justifyContent:"center",
      padding:16,background:"rgba(0,0,0,0.72)",backdropFilter:"blur(6px)"}}>
      <div style={{width:"100%",maxWidth:480,
        background:C.bg("card"),border:`1px solid ${C.bdr()}`,
        borderRadius:18,overflow:"hidden",boxShadow:SHM,
        animation:"ioFadeIn .2s ease"}}>

        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>

        {/* Header */}
        <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.bdr()}`,
          background:C.bg("surf"),display:"flex",alignItems:"center",
          justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:9,
              background:C.steel(0.12),border:`1px solid ${C.steel(0.3)}`,
              display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Cpu size={15} color={C.steel()}/>
            </div>
            <div>
              <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:1}}>
                Test PLC Connection
              </p>
              <p style={{fontSize:13,fontWeight:700,color:C.txt("pri")}}>
                {plc.name}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:6,
            background:"none",border:`1px solid ${C.bdr()}`,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
            color:C.txt("muted")}}>
            <X size={13}/>
          </button>
        </div>

        {/* Body */}
        <div style={{padding:"18px 20px 22px"}}>
          {/* PLC info */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:18}}>
            {[
              {label:"IP Address", value:plc.ip,       mono:true },
              {label:"Port",       value:plc.port,     mono:true },
              {label:"Protocol",   value:plc.protocol, mono:false},
            ].map((f,i)=>(
              <div key={i} style={{background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                borderRadius:9,padding:"9px 11px"}}>
                <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                  letterSpacing:"0.08em",color:C.txt("muted"),marginBottom:4}}>{f.label}</p>
                <p style={{fontSize:12,fontWeight:700,color:C.txt("pri"),
                  fontFamily:f.mono?"'DM Mono',monospace":"inherit"}}>{f.value||"—"}</p>
              </div>
            ))}
          </div>

          {/* Test register fields */}
          <p style={{fontSize:11,fontWeight:700,color:C.txt("sec"),marginBottom:10,
            display:"flex",alignItems:"center",gap:6}}>
            {isMitsu
              ? <><Radio size={12}/> SLMP — Read a device register (e.g. D100)</>
              : <><Server size={12}/> Modbus TCP — Read a holding register (e.g. 40001)</>}
          </p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
            <div>
              <Label>{isMitsu?"Device Register":"Register Address"}</Label>
              <input value={register} onChange={e=>setRegister(e.target.value)}
                placeholder={isMitsu?"D100":"40001"}
                style={{...inpM("reg"),fontFamily:"'DM Mono',monospace"}}
                onFocus={()=>setFocus("reg")} onBlur={()=>setFocus("")}/>
            </div>
            <div>
              <Label>Test Value</Label>
              <div style={{display:"flex",gap:6}}>
                {[0,1].map(p=>(
                  <button key={p} onClick={()=>setTestVal(String(p))}
                    style={{width:38,height:38,borderRadius:7,fontSize:14,fontWeight:800,
                      cursor:"pointer",
                      background:testVal===String(p)?C.amber(0.15):"transparent",
                      border:`1px solid ${testVal===String(p)?C.amber(0.4):C.bdr()}`,
                      color:testVal===String(p)?C.amber():C.txt("muted"),
                      transition:"all .12s"}}>
                    {p}
                  </button>
                ))}
                <input value={testVal} onChange={e=>setTestVal(e.target.value)}
                  placeholder="val"
                  style={{...inpM("val"),flex:1,fontFamily:"'DM Mono',monospace",textAlign:"center"}}
                  onFocus={()=>setFocus("val")} onBlur={()=>setFocus("")}/>
              </div>
            </div>
          </div>

          {/* Result */}
          {result&&(
            <div style={{display:"flex",alignItems:"flex-start",gap:10,
              padding:"12px 14px",borderRadius:10,marginBottom:18,
              background:result.success?C.ok(0.07):C.ng(0.07),
              border:`1px solid ${result.success?C.ok(0.22):C.ng(0.22)}`,
              animation:"ioFadeIn .2s ease"}}>
              {result.success
                ? <CheckCircle2 size={16} color={C.ok()} style={{flexShrink:0,marginTop:1}}/>
                : <AlertCircle  size={16} color={C.ng()} style={{flexShrink:0,marginTop:1}}/>}
              <div>
                <p style={{fontSize:12,fontWeight:700,marginBottom:4,
                  color:result.success?C.ok():C.ng()}}>
                  {result.success?"Test Passed":"Test Failed"}
                </p>
                <p style={{fontSize:11,lineHeight:1.5,
                  color:result.success?C.ok(0.85):C.ng(0.85)}}>
                  {result.message}
                </p>
                <p style={{fontSize:10,color:C.txt("muted"),marginTop:4,
                  fontFamily:"'DM Mono',monospace"}}>
                  Response time: {result.latency}ms
                </p>
                {result.request && (
                  <p style={{fontSize:10,color:C.txt("muted"),marginTop:4,fontFamily:"'DM Mono',monospace",wordBreak:"break-all"}}>
                    Sent: {JSON.stringify(result.request)}
                  </p>
                )}
                {result.probe && (
                  <p style={{fontSize:10,color:C.txt("muted"),marginTop:3,fontFamily:"'DM Mono',monospace",wordBreak:"break-all"}}>
                    Received: {JSON.stringify(result.probe)}
                  </p>
                )}
                {!result.success && result.error && (
                  <p style={{fontSize:10,color:C.ng(0.9),marginTop:3,fontFamily:"'DM Mono',monospace",wordBreak:"break-all"}}>
                    Error: {result.error}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Buttons */}
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={onClose} variant="ghost" style={{flex:1,justifyContent:"center"}}>
              Close
            </Btn>
            <Btn onClick={runTest} loading={testing} variant="amber"
              style={{flex:2,justifyContent:"center"}}>
              {!testing&&<Zap size={14}/>}
              {testing?"Testing…":result?"Test Again":"Run Test"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
//  IoMonitor MAIN
// ══════════════════════════════════════════════════════════════════════════
const IoMonitor = () => {
  injectDS();

  const userRole   = getUserRole();
  const canControl = useMemo(()=>["admin","engineer"].includes(normalizeRole(userRole)),[userRole]);

  const [machines,          setMachines]          = useState([]);
  const [loadingMachines,   setLoadingMachines]   = useState(true);
  const [selectedPlcIp,     setSelectedPlcIp]     = useState("");
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [snapshot,          setSnapshot]          = useState(null);
  const [loadingSnap,       setLoadingSnap]       = useState(false);
  const [refreshingSnap,    setRefreshingSnap]    = useState(false);
  const [errorMsg,          setErrorMsg]          = useState("");
  const [activeTab,         setActiveTab]         = useState("plc_list"); // start on PLC list
  const [focus,             setFocus]             = useState("");
  const [testPlcItem,       setTestPlcItem]       = useState(null);
  const [actionLogs,        setActionLogs]        = useState([]);
  const [mappedWriteDraft,  setMappedWriteDraft]  = useState({});
  const [showResetConfirm,  setShowResetConfirm]  = useState(false);

  const [acting,  setActing]   = useState({testing:false,resetting:false,writing:false,reading:false,commanding:false});
  const [mappedReadKey,  setMappedReadKey]  = useState("");
  const [mappedWriteKey, setMappedWriteKey] = useState("");
  const [writeSignal,    setWriteSignal]     = useState("TRIGGER");
  const [writeValue,     setWriteValue]      = useState("");
  const [customReg,      setCustomReg]       = useState("");
  const [commandStation, setCommandStation]  = useState("");
  const [plcCommand,     setPlcCommand]      = useState("START_OPERATION");

  const pushActionLog = useCallback((entry)=>{
    const row = { at: new Date().toISOString(), ...entry };
    setActionLogs(prev=>[row,...prev].slice(0,40));
  },[]);

  const inFlightRef = useRef(false);

  const loadMachines = useCallback(async({ silent = false } = {})=>{
    try {
      if (!silent) setLoadingMachines(true);
      const rows = await machineApi.list();
      setMachines((rows||[]).filter(r=>String(r.status||"ACTIVE").toUpperCase()==="ACTIVE"));
    } catch(e){
      if (!silent) {
        setMachines([]);
        setErrorMsg(e.response?.data?.error||"Unable to load machines.");
      }
    }
    finally { if (!silent) setLoadingMachines(false); }
  },[]);

  useEffect(()=>{ loadMachines(); },[loadMachines]);
  useEffect(()=>{
    const timer = setInterval(() => loadMachines({ silent: true }), 10000);
    return () => clearInterval(timer);
  },[loadMachines]);

  const plcOptions = useMemo(()=>
    Array.from(new Set(machines.map(m=>normalizeIp(m.plcIp||m.machineIp)).filter(Boolean))).sort()
  ,[machines]);

  const filteredMachines = useMemo(()=>
    selectedPlcIp?machines.filter(m=>normalizeIp(m.plcIp||m.machineIp)===selectedPlcIp):machines
  ,[machines,selectedPlcIp]);

  useEffect(()=>{
    if (!filteredMachines.length){setSelectedMachineId("");setSnapshot(null);return;}
    if (!filteredMachines.some(m=>String(m.id)===String(selectedMachineId)))
      setSelectedMachineId(String(filteredMachines[0].id));
  },[filteredMachines,selectedMachineId]);

  const loadSnapshot = useCallback(async({silent=false, force=false}={})=>{
    const machineId=Number(selectedMachineId||0);
    if (!machineId||inFlightRef.current) return;
    inFlightRef.current=true;
    if (silent) setRefreshingSnap(true); else setLoadingSnap(true);
    try {
      const data=await traceabilityApi.ioSnapshot({machineId,plcIp:selectedPlcIp||undefined,force});
      setSnapshot(data||null); setErrorMsg("");
    } catch(e){ setSnapshot(null); setErrorMsg(e.response?.data?.error||"Unable to load signal data."); }
    finally {
      if (silent) setRefreshingSnap(false); else setLoadingSnap(false);
      inFlightRef.current=false;
    }
  },[selectedMachineId,selectedPlcIp]);

  useEffect(()=>{
    if (!selectedMachineId) return;
    loadSnapshot({silent:false});
    if (activeTab==="plc_list") return;
    const t=setInterval(()=>{
      if (typeof document!=="undefined" && document.hidden) return;
      loadSnapshot({silent:true});
    },SNAPSHOT_POLL_INTERVAL_MS);
    return()=>clearInterval(t);
  },[selectedMachineId,selectedPlcIp,loadSnapshot,activeTab]);

  const selectedMachine=filteredMachines.find(m=>String(m.id)===String(selectedMachineId))||null;

  useEffect(()=>{
    if (selectedMachine) setCommandStation(selectedMachine.operationNo||selectedMachine.stationNo||"");
  },[selectedMachine]);

  const rows=useMemo(()=>Array.isArray(snapshot?.rows)?snapshot.rows:[],[snapshot?.rows]);

  useEffect(()=>{
    if (!Array.isArray(rows) || rows.length===0) return;
    setMappedWriteDraft((prev)=>{
      const next = { ...prev };
      for (const r of rows) {
        const key = String(r.register ?? "");
        if (!key) continue;
        if (next[key] === undefined || next[key] === "") {
          const base = toIntOrNull(r.currentValue);
          next[key] = String(base ?? 0);
        }
      }
      return next;
    });
  },[rows]);

  const writableOpts=useMemo(()=>{
    const seen=new Set();const opts=[];
    for (const r of rows){
      const k=String(r.signalKey||r.signal||"").trim().toUpperCase();
      const reg = toIntOrNull(r.register);
      if (!k||seen.has(k)||!r.writable||reg===null||reg<1) continue;
      seen.add(k);
      opts.push({key:k,label:r.signal||k,register:reg,currentValue:toIntOrNull(r.currentValue)});
    }
    return opts.length>0?opts:[
      {key:"TRIGGER",label:"Start Signal (Trigger)",register:null,currentValue:null},
      {key:"RESET",  label:"Reset Signal",           register:null,currentValue:null},
    ];
  },[rows]);

  const getMappedReg=useCallback((m,sig)=>{
    if (!m) return null;
    const c=m.plcConfig||{};
    if (sig==="TRIGGER") return toIntOrNull(c.startRegister??m.plcStartRegister);
    if (sig==="RESET")   return toIntOrNull(c.resetRegister??m.plcResetRegister);
    return null;
  },[]);
  const getMappedVal=useCallback((m,sig)=>{
    if (!m) return null;
    const c=m.plcConfig||{};
    if (sig==="TRIGGER") return toIntOrNull(c.startValue??m.plcStartValue)??1;
    if (sig==="RESET")   return toIntOrNull(c.resetValue??m.plcResetValue)??9;
    return null;
  },[]);

  useEffect(()=>{
    if (!selectedMachine){setWriteSignal("TRIGGER");setWriteValue("");setCustomReg("");return;}
    const def=writableOpts[0]?.key||"TRIGGER";
    setWriteSignal(def);
    setWriteValue(String(getMappedVal(selectedMachine,def)??writableOpts.find(e=>e.key===def)?.currentValue??1));
    setCustomReg("");
  },[selectedMachine,getMappedVal,writableOpts]);

  // Build PLC list from machines
  const plcList = useMemo(()=>{
    const seen=new Set();const list=[];
    const snapMachineId = Number(snapshot?.machine?.id || 0);
    const snapConnected = snapshot?.plcConnection?.connected;
    for (const m of machines){
      const ip=normalizeIp(m.plcIp||m.machineIp);
      const port=m.plcPort||m.machinePort||502;
      const key=`${ip}:${port}`;
      if (!ip||seen.has(key)) continue;
      seen.add(key);
      const proto=(m.plcProtocol||m.protocol||"Modbus TCP").toUpperCase();
      const isMitsu=proto.includes("SLMP")||proto.includes("MITSUBISHI");
      const linked=machines.filter(x=>normalizeIp(x.plcIp||x.machineIp)===ip);
      const startReg=m.plcStartRegister||m.plcConfig?.startRegister||(isMitsu?"D100":"40001");
      const resetReg=m.plcResetRegister||m.plcConfig?.resetRegister||(isMitsu?"D102":"40003");
      const statusReg=m.plcStatusRegister||m.plcConfig?.statusRegister||(isMitsu?"D101":"40002");
      const connectedFromLive =
        snapMachineId && Number(m.id) === snapMachineId
          ? (snapConnected === undefined ? null : Boolean(snapConnected))
          : null;
      list.push({
        id:key, ip, port, protocol:proto, isMitsu,
        name:m.plcName||`PLC — ${ip}`,
        machineId:m.id, machineName:m.machineName,
        startReg, statusReg, resetReg,
        plcTestTimeoutMs: toIntOrNull(m.plcTestTimeoutMs),
        plcTestRetryCount: toIntOrNull(m.plcTestRetryCount),
        slmpDevice:(m.plcSlmpDevice||m.plcConfig?.slmpDevice||"D"),
        slmpFrameMode:(m.plcSlmpFrameMode||m.plcConfig?.slmpFrameMode||"AUTO"),
        linkedMachines:linked.map(x=>x.machineName||x.name).filter(Boolean),
        connected:connectedFromLive !== null
          ? connectedFromLive
          : (m.plcConnected!==undefined?Boolean(m.plcConnected):null),
        testRegister:m.plcTestRegister,
      });
    }
    return list;
  },[machines,snapshot?.machine?.id,snapshot?.plcConnection?.connected]);

  // PLC actions
  const handleTest=async()=>{
    if (!selectedMachine) return;
    setActing(p=>({...p,testing:true}));
    const req = {
      machineId:selectedMachine.id,
      plcSlmpFrameMode:selectedMachine.plcSlmpFrameMode||selectedMachine.plcConfig?.slmpFrameMode||"AUTO",
    };
    try {
      const res=await machineApi.testPlc(req);
      toast.success(res?.message||"PLC connection test passed.");
      pushActionLog({ action:"TEST", ok:true, request:req, response:res?.probe||res||null });
    }
    catch(e){
      const msg = toErr(e,"PLC test failed");
      toast.error(msg);
      pushActionLog({ action:"TEST", ok:false, request:req, error:e?.response?.data?.error||msg });
    }
    finally { setActing(p=>({...p,testing:false})); }
  };
  const handleReset=async()=>{
    if (!selectedMachine) return;
    setActing(p=>({...p,resetting:true}));
    try {
      const req = {
        machineId:selectedMachine.id,
        stationNo:selectedMachine.operationNo||selectedMachine.stationNo,
        plcSlmpFrameMode:selectedMachine.plcSlmpFrameMode||selectedMachine.plcConfig?.slmpFrameMode||"AUTO",
      };
      const res = await machineApi.resetPlc(req);
      toast.success("PLC reset signal sent.");
      pushActionLog({ action:"RESET", ok:true, request:req, response:res?.reset||res||null });
      await loadSnapshot({silent:false});
    } catch(e){
      const msg = toErr(e,"PLC reset failed");
      toast.error(msg);
      pushActionLog({ action:"RESET", ok:false, request:{machineId:selectedMachine.id}, error:e?.response?.data?.error||msg });
    }
    finally { setActing(p=>({...p,resetting:false})); }
  };
  const handleCardWrite=async(row,val,onDone)=>{
    if (!selectedMachine) return;
    const reg=toIntOrNull(row?.register);
    if (reg===null || reg<1) return toast.error("Mapped register is invalid.");
    setActing(p=>({...p,writing:true}));
    try {
      const req = {
        machineId:selectedMachine.id,
        value:val,
        registerNo:reg,
        signalKey:String(row.signalKey||row.signal||"").toUpperCase()||undefined,
        plcSlmpDevice:selectedMachine.plcSlmpDevice||"D",
        plcSlmpFrameMode:selectedMachine.plcSlmpFrameMode||selectedMachine.plcConfig?.slmpFrameMode||"AUTO",
        timeoutMs: Math.max(toIntOrNull(selectedMachine?.plcTestTimeoutMs) || 8000, 1000),
        retryCount: Math.max(toIntOrNull(selectedMachine?.plcTestRetryCount) || 2, 1),
      };
      const res = await machineApi.writePlcValue(req);
      toast.success(`${row.signal||"Register"} ${reg} → ${val}`);
      pushActionLog({ action:"WRITE", ok:true, request:req, response:res?.write||res||null });
      onDone?.();
      await loadSnapshot({silent:false});
    } catch(e){
      const msg = toErr(e,"Write failed");
      toast.error(msg);
      pushActionLog({ action:"WRITE", ok:false, request:{machineId:selectedMachine.id,registerNo:reg,value:val}, error:e?.response?.data?.error||msg });
    }
    finally { setActing(p=>({...p,writing:false})); }
  };
  const updateMappedDraft = useCallback((registerNo, value)=>{
    const key = String(registerNo ?? "");
    if (!key) return;
    setMappedWriteDraft((prev)=>({ ...prev, [key]: String(value ?? "") }));
  },[]);
  const handleMappedRead = useCallback(async(row)=>{
    if (!selectedMachine) return;
    const reg = toIntOrNull(row?.register);
    if (reg===null) return toast.error("Mapped register missing.");
    const rowKey = `${String(row?.signalKey||row?.signal||"").toUpperCase()}_${reg}`;
    setMappedReadKey(rowKey);
    setActing((p)=>({ ...p, reading:true }));
    try {
      const req = {
        machineId:selectedMachine.id,
        registerNo:reg,
        signalKey:String(row.signalKey||row.signal||"").toUpperCase()||undefined,
        plcSlmpDevice:String(row.device || selectedMachine?.plcSlmpDevice || "D").toUpperCase(),
        plcSlmpFrameMode:selectedMachine.plcSlmpFrameMode||selectedMachine.plcConfig?.slmpFrameMode||"AUTO",
        timeoutMs: Math.max(toIntOrNull(selectedMachine?.plcTestTimeoutMs) || 8000, 1000),
      };
      const res = await machineApi.readPlcValue(req, { timeout: 30000 });
      const val = res?.read?.value ?? "N/A";
      toast.success(`${row.device||selectedMachine?.plcSlmpDevice||"D"}${reg} = ${val}`);
      pushActionLog({
        action:"READ",
        ok:true,
        request:req,
        response:res?.read||{ value: val },
      });
      await loadSnapshot({silent:false,force:true});
    } catch(e){
      const msg = toErr(e,"Read failed");
      toast.error(msg);
      pushActionLog({
        action:"READ",
        ok:false,
        request:{ machineId:selectedMachine.id, registerNo:reg, signalKey:row.signalKey||null },
        error:e?.response?.data?.error||msg,
      });
    } finally {
      setActing((p)=>({ ...p, reading:false }));
      setMappedReadKey("");
    }
  },[selectedMachine,pushActionLog,loadSnapshot]);
  const handleMappedWrite = useCallback(async(row)=>{
    if (!selectedMachine) return;
    const reg = toIntOrNull(row?.register);
    if (reg===null || reg<1) return toast.error("Mapped register missing.");
    const draft = mappedWriteDraft[String(reg)];
    const val = toIntOrNull(draft);
    if (val===null) return toast.error("Enter valid value.");
    const rowKey = `${String(row?.signalKey||row?.signal||"").toUpperCase()}_${reg}`;
    setMappedWriteKey(rowKey);
    try {
      await handleCardWrite(row,val);
    } finally {
      setMappedWriteKey("");
    }
  },[selectedMachine,mappedWriteDraft,handleCardWrite]);
  const handleWrite=async()=>{
    if (!selectedMachine) return;
    const customParsed = parseSlmpRegisterInput(customReg, selectedMachine?.plcSlmpDevice || "D");
    const customRegister = customParsed.register;
    const reg=writeSignal==="CUSTOM"?customRegister:(writableOpts.find(e=>e.key===writeSignal)?.register??getMappedReg(selectedMachine,writeSignal));
    const val=toIntOrNull(writeValue);
    if (reg===null||val===null) return toast.error("Enter a valid register and value.");
    if (writeSignal!=="CUSTOM" && reg<1) return toast.error("Mapped register is invalid.");
    setActing(p=>({...p,writing:true}));
    try {
      const req = {
        machineId:selectedMachine.id,
        value:val,
        registerNo:reg,
        signalKey:writeSignal!=="CUSTOM"?writeSignal:undefined,
        plcSlmpDevice:writeSignal==="CUSTOM" ? customParsed.device : (selectedMachine.plcSlmpDevice||"D"),
        plcSlmpFrameMode:selectedMachine.plcSlmpFrameMode||selectedMachine.plcConfig?.slmpFrameMode||"AUTO",
        timeoutMs: Math.max(toIntOrNull(selectedMachine?.plcTestTimeoutMs) || 8000, 1000),
        retryCount: Math.max(toIntOrNull(selectedMachine?.plcTestRetryCount) || 2, 1),
      };
      const res = await machineApi.writePlcValue(req);
      toast.success(`Register ${reg} set to ${val}`);
      pushActionLog({ action:"WRITE", ok:true, request:req, response:res?.write||res||null });
      await loadSnapshot({silent:false});
    } catch(e){
      const msg = toErr(e,"Write failed");
      toast.error(msg);
      pushActionLog({ action:"WRITE", ok:false, request:{machineId:selectedMachine.id,registerNo:reg,value:val}, error:e?.response?.data?.error||msg });
    }
    finally { setActing(p=>({...p,writing:false})); }
  };
  const handleCommand=async()=>{
    if (!selectedMachine) return;
    setActing(p=>({...p,commanding:true}));
    try {
      const req = {
        machineId:selectedMachine.id,
        command:plcCommand,
        stationNo:commandStation,
        plcSlmpFrameMode:selectedMachine.plcSlmpFrameMode||selectedMachine.plcConfig?.slmpFrameMode||"AUTO",
      };
      const res = await machineApi.sendPlcCommand(req);
      toast.success("PLC command sent.");
      pushActionLog({ action:"COMMAND", ok:true, request:req, response:res?.result||res||null });
      await loadSnapshot({silent:false});
    } catch(e){
      const msg = toErr(e,"Command failed");
      toast.error(msg);
      pushActionLog({ action:"COMMAND", ok:false, request:{machineId:selectedMachine.id,command:plcCommand,stationNo:commandStation}, error:e?.response?.data?.error||msg });
    }
    finally { setActing(p=>({...p,commanding:false})); }
  };
  const downloadIoLiveSpec = useCallback(()=>{
    try {
      const text = buildIoLiveSpecText({ machine:selectedMachine, snapshot, rows });
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const name = String(selectedMachine?.machineName || "machine").trim().replace(/[^\w\-]+/g, "_");
      a.href = url;
      a.download = `${name || "machine"}_io_live_register_spec.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("I/O live register spec downloaded");
    } catch {
      toast.error("Unable to generate I/O live register spec");
    }
  },[selectedMachine,snapshot,rows]);

  const plcTransportConnected = Boolean(snapshot?.plcConnection?.transportConnected);
  const plcReadConnected = Boolean(snapshot?.plcConnection?.readConnected);
  const plcConnected     = Boolean(snapshot?.plcConnection?.connected ?? plcTransportConnected);
  const queueRows        = Array.isArray(snapshot?.plcQueue) ? snapshot.plcQueue : [];
  const protocol         = (snapshot?.plc?.protocol||selectedMachine?.plcProtocol||"Modbus TCP").toUpperCase();
  const plcIp            = snapshot?.plc?.ip||selectedMachine?.plcIp||"—";
  const plcPort          = snapshot?.plc?.port||selectedMachine?.plcPort||"—";
  const plcModeNote = plcReadConnected
    ? "TCP + register read OK"
    : plcTransportConnected
      ? "TCP connected, register read pending/failed"
      : "No TCP link";
  const hasPlcError = Boolean(snapshot?.plcConnection?.error);
  const plcErrorIsWarning = hasPlcError && plcTransportConnected;

  const TABS=[
    {key:"plc_list", label:"PLC Overview",    icon:List   },
    {key:"signals",  label:"Mapped I/O",      icon:Signal },
    {key:"logs",     label:"Connection Log",  icon:History},
  ];

  // ═════════════════════════════════════════════════════════════════════
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18,paddingBottom:32,animation:"ioFadeIn .3s ease"}}>

      {/* PLC Test Modal */}
      {testPlcItem&&<PlcTestModal plc={testPlcItem} onClose={()=>setTestPlcItem(null)}/>}

      {/* ── Header ────────────────────────────────────────────────── */}
      <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
        borderRadius:16,padding:"16px 20px",boxShadow:SH,overflow:"hidden"}}>
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,margin:"-16px -20px 14px"}}/>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:13}}>
            <div style={{width:44,height:44,borderRadius:12,flexShrink:0,
              background:`linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
              display:"flex",alignItems:"center",justifyContent:"center",
              boxShadow:`0 4px 12px ${C.navy(0.35)}`}}>
              <Activity size={21} color={C.linen()}/>
            </div>
            <div>
              <h1 style={{fontSize:17,fontWeight:800,color:C.txt("pri"),letterSpacing:"-0.02em",lineHeight:1.2}}>
                I/O Signal Monitor
              </h1>
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:3}}>
                <div style={{position:"relative",width:7,height:7}}>
                  <div style={{position:"absolute",inset:0,borderRadius:"50%",background:C.ok(),animation:"ioPing 1.6s ease-out infinite",opacity:0.6}}/>
                  <div style={{width:7,height:7,borderRadius:"50%",background:C.ok()}}/>
                </div>
                <p style={{fontSize:11,color:C.txt("muted")}}>
                  Live polling every {Math.round(SNAPSHOT_POLL_INTERVAL_MS / 1000)} seconds
                </p>
              </div>
            </div>
          </div>
          <Btn onClick={()=>loadSnapshot({silent:false,force:true})} loading={refreshingSnap||loadingSnap} variant="ghost">
            <RefreshCw size={12}/> Refresh
          </Btn>
          <Btn onClick={downloadIoLiveSpec} variant="steel">
            <Save size={12}/> Download Live Spec
          </Btn>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div style={{display:"flex",gap:5,padding:5,background:C.bg("card"),
        border:`1px solid ${C.bdr()}`,borderRadius:11,
        width:"fit-content",overflowX:"auto",maxWidth:"100%"}}>
        {TABS.map(tab=>{
          const active=activeTab===tab.key;
          const TI=tab.icon;
          return (
            <button key={tab.key} onClick={()=>setActiveTab(tab.key)}
              style={{display:"inline-flex",alignItems:"center",gap:6,
                height:34,padding:"0 14px",borderRadius:7,
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

      {/* ══ TAB: PLC Overview ═══════════════════════════════════ */}
      {activeTab==="plc_list" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>

          {/* Summary strip */}
          <div style={{display:"grid",
            gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
            {[
              {label:"Total PLCs",     value:plcList.length,                                                   color:C.steel(), icon:Cpu   },
              {label:"Connected",      value:plcList.filter(p=>p.connected===true).length,                     color:C.ok(),    icon:Wifi  },
              {label:"Offline",        value:plcList.filter(p=>p.connected===false).length,                    color:C.ng(),    icon:WifiOff},
              {label:"Status Unknown", value:plcList.filter(p=>p.connected===null).length,                     color:C.amber(), icon:AlertCircle},
              {label:"Queued Ops",     value:queueRows.reduce((acc,row)=>acc+Number(row.queued||0),0),         color:C.steel(), icon:Clock},
            ].map((s,i)=>(
              <div key={i} style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
                borderLeft:`3px solid ${s.color}`,borderRadius:12,
                padding:"12px 14px",boxShadow:SH,
                display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:8,flexShrink:0,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  background:`${s.color.replace("1)","0.1)")}`}}>
                  <s.icon size={15} color={s.color}/>
                </div>
                <div>
                  <p style={{fontSize:10,fontWeight:700,textTransform:"uppercase",
                    letterSpacing:"0.07em",color:C.txt("muted"),marginBottom:2}}>{s.label}</p>
                  <p style={{fontSize:22,fontWeight:800,color:C.txt("pri"),
                    fontFamily:"'DM Mono',monospace",lineHeight:1}}>{s.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* PLC Table */}
          <SCard noPad title="All PLC Controllers" subtitle="Network Registry"
            right={
              <p style={{fontSize:11,color:C.txt("muted")}}>
                Click Test to verify connection
              </p>
            }>
            {plcList.length===0 ? (
              <div style={{padding:"48px 24px",textAlign:"center"}}>
                <Cpu size={28} color={C.txt("muted")} style={{margin:"0 auto 12px"}}/>
                <p style={{fontSize:13,fontWeight:600,color:C.txt("sec"),marginBottom:6}}>
                  No PLC controllers found
                </p>
                <p style={{fontSize:12,color:C.txt("muted")}}>
                  Configure machines with PLC IP addresses to see them here.
                </p>
              </div>
            ) : (
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                      {["Status","PLC Name / IP","Port","Protocol","Start Reg","Status Reg","Reset Reg","Linked Machines","Test"].map(h=>(
                        <th key={h} style={{padding:"10px 14px",textAlign:"left",
                          fontSize:9,fontWeight:800,textTransform:"uppercase",
                          letterSpacing:"0.09em",color:C.txt("muted"),whiteSpace:"nowrap"}}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plcList.map((plc,i)=>(
                      <tr key={plc.id} style={{
                        borderBottom:`1px solid ${C.bdr()}`,
                        background:i%2===1?C.bg("surf"):"transparent",
                        transition:"background .1s",
                      }}
                        onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.04)}
                        onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.bg("surf"):"transparent"}
                      >
                        {/* Status */}
                        <td style={{padding:"12px 14px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:7}}>
                            <div style={{position:"relative",width:10,height:10,flexShrink:0}}>
                              {plc.connected===true&&(
                                <div style={{position:"absolute",inset:0,borderRadius:"50%",
                                  background:C.ok(0.4),animation:"ioPing 1.8s ease-out infinite"}}/>
                              )}
                              <div style={{width:10,height:10,borderRadius:"50%",position:"relative",
                                background:plc.connected===true?C.ok():plc.connected===false?C.ng():C.idle()}}/>
                            </div>
                            {plc.connected===null
                              ? <Badge variant="idle"  label="Unknown"/>
                              : plc.connected
                                ? <Badge variant="ok"  label="Online"  pulse/>
                                : <Badge variant="ng"  label="Offline"/>}
                          </div>
                        </td>
                        {/* Name / IP */}
                        <td style={{padding:"12px 14px"}}>
                          <p style={{fontSize:12,fontWeight:700,color:C.txt("pri"),marginBottom:3}}>
                            {plc.name}
                          </p>
                          <p style={{fontFamily:"'DM Mono',monospace",fontSize:11,
                            fontWeight:600,color:C.steel()}}>
                            {plc.ip}
                          </p>
                        </td>
                        {/* Port */}
                        <td style={{padding:"12px 14px"}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,
                            fontWeight:700,color:C.txt("pri")}}>{plc.port}</span>
                        </td>
                        {/* Protocol */}
                        <td style={{padding:"12px 14px"}}>
                          <Badge
                            variant={plc.isMitsu?"steel":"amber"}
                            label={plc.isMitsu?"Mitsubishi SLMP":"Modbus TCP"}
                          />
                        </td>
                        {/* Start reg */}
                        <td style={{padding:"12px 14px"}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,
                            fontWeight:700,color:C.ok()}}>{plc.startReg||"—"}</span>
                        </td>
                        {/* Status reg */}
                        <td style={{padding:"12px 14px"}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,
                            fontWeight:700,color:C.steel()}}>{plc.statusReg||"—"}</span>
                        </td>
                        {/* Reset reg */}
                        <td style={{padding:"12px 14px"}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,
                            fontWeight:700,color:C.ng()}}>{plc.resetReg||"—"}</span>
                        </td>
                        {/* Linked machines */}
                        <td style={{padding:"12px 14px"}}>
                          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                            {plc.linkedMachines.slice(0,2).map((m,j)=>(
                              <span key={j} style={{fontSize:9,fontWeight:700,
                                padding:"2px 7px",borderRadius:4,
                                background:C.navy(0.1),border:`1px solid ${C.navy(0.25)}`,
                                color:C.steel(),whiteSpace:"nowrap"}}>
                                {m}
                              </span>
                            ))}
                            {plc.linkedMachines.length>2&&(
                              <span style={{fontSize:9,color:C.txt("muted"),padding:"2px 4px"}}>
                                +{plc.linkedMachines.length-2}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Test button */}
                        <td style={{padding:"12px 14px"}}>
                          <Btn size="sm" variant="amber"
                            onClick={()=>setTestPlcItem(plc)}>
                            <Play size={11}/> Test
                          </Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SCard>

          {/* Register color legend */}
          <div style={{display:"flex",alignItems:"center",gap:20,
            padding:"10px 16px",borderRadius:10,
            background:C.bg("card"),border:`1px solid ${C.bdr()}`,
            flexWrap:"wrap",boxShadow:SH}}>
            <p style={{fontSize:11,fontWeight:700,color:C.txt("muted")}}>Register legend:</p>
            {[
              {color:C.ok(),   label:"Start Reg   — Write 1 to trigger operation start"},
              {color:C.steel(),label:"Status Reg  — Read to check PLC acknowledgment"},
              {color:C.ng(),   label:"Reset Reg   — Write to clear and reset after cycle"},
            ].map((l,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:10,height:10,borderRadius:3,background:l.color,flexShrink:0}}/>
                <span style={{fontSize:11,color:C.txt("muted")}}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ TAB: Signal Monitor ═══════════════════════════════════ */}
      {activeTab==="signals" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* Machine selector */}
          <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
            borderRadius:12,padding:14,boxShadow:SH}}>
            <p style={{fontSize:10,fontWeight:800,textTransform:"uppercase",
              letterSpacing:"0.09em",color:C.txt("muted"),marginBottom:10}}>
              Select Machine
            </p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <Label>Filter by PLC IP</Label>
                <select value={selectedPlcIp}
                  onChange={e=>setSelectedPlcIp(e.target.value)}
                  style={{...inp(focus==="plcip"),fontFamily:"'DM Mono',monospace",fontSize:11}}
                  onFocus={()=>setFocus("plcip")} onBlur={()=>setFocus("")}>
                  <option value="">All PLC Controllers</option>
                  {plcOptions.map(ip=><option key={ip} value={ip}>{ip}</option>)}
                </select>
              </div>
              <div>
                <Label>Machine / Station</Label>
                {loadingMachines?(
                  <div style={{height:38,borderRadius:8,background:C.bg("surf"),
                    border:`1px solid ${C.bdr()}`,display:"flex",alignItems:"center",
                    paddingLeft:11,gap:7}}>
                    <RefreshCw size={12} color={C.txt("muted")} style={{animation:"ioSpin .9s linear infinite"}}/>
                    <span style={{fontSize:11,color:C.txt("muted")}}>Loading…</span>
                  </div>
                ):(
                  <select value={selectedMachineId}
                    onChange={e=>setSelectedMachineId(e.target.value)}
                    style={inp(focus==="machine")}
                    onFocus={()=>setFocus("machine")} onBlur={()=>setFocus("")}>
                    {filteredMachines.length===0
                      ? <option>No machines available</option>
                      : filteredMachines.map(m=>(
                        <option key={m.id} value={m.id}>
                          {m.machineName} — {m.operationNo||m.stationNo||"—"}{m.machineBypassEnabled ? " [BYPASS]" : ""}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* Connection status */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
            <ConnCard connected={plcConnected} label="PLC Controller"
              sublabel={`${plcIp} : ${plcPort} • ${plcModeNote}`} protocol={protocol}/>
            <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderLeft:`3px solid ${C.steel()}`,borderRadius:12,
              padding:"14px 16px",boxShadow:SH,display:"flex",alignItems:"center",gap:11}}>
              <div style={{width:36,height:36,borderRadius:"50%",flexShrink:0,
                background:C.steel(0.1),border:`1px solid ${C.steel(0.25)}`,
                display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Clock size={16} color={C.steel()}/>
              </div>
              <div>
                <p style={{fontSize:12,fontWeight:800,color:C.txt("pri"),marginBottom:2}}>Last Updated</p>
                <p style={{fontSize:11,color:C.txt("muted"),fontFamily:"'DM Mono',monospace"}}>
                  {fmtTime(snapshot?.refreshedAt)||"—"}
                </p>
              </div>
            </div>
          </div>

          {errorMsg&&(
            <div style={{display:"flex",alignItems:"center",gap:9,padding:"10px 14px",
              borderRadius:9,background:C.ng(0.07),border:`1px solid ${C.ng(0.22)}`,
              color:C.ng(),fontSize:12,fontWeight:600}}>
              <AlertCircle size={14} style={{flexShrink:0}}/>{errorMsg}
            </div>
          )}

          {/* Mapped register table */}
          <SCard noPad title="Mapped Registers" subtitle="Machine Add Mapping">
            <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.bdr()}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
              <p style={{fontSize:12,fontWeight:700,color:C.txt("pri")}}>
                {selectedMachine?.machineName || "Machine"} mapped I/O registers
              </p>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:11,color:C.txt("muted"),
                  background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                  padding:"2px 8px",borderRadius:5}}>
                  {rows.length} mapped rows
                </span>
                <Badge
                  variant={selectedMachine?.machineBypassEnabled ? "wip" : "ok"}
                  label={selectedMachine?.machineBypassEnabled ? "Bypass ON" : "Bypass OFF"}
                />
                <Badge variant={plcConnected?"ok":"ng"}
                  label={plcConnected?"PLC Online":"PLC Offline"} pulse={plcConnected}/>
              </div>
            </div>
            {loadingSnap?(
              <div style={{padding:"36px 20px",textAlign:"center"}}>
                <RefreshCw size={22} color={C.txt("muted")} style={{margin:"0 auto 10px",animation:"ioSpin .9s linear infinite"}}/>
                <p style={{fontSize:12,color:C.txt("muted")}}>Loading mapped register values…</p>
              </div>
            ):rows.length===0?(
              <div style={{padding:"36px 20px",textAlign:"center"}}>
                <Signal size={24} color={C.txt("muted")} style={{margin:"0 auto 10px"}}/>
                <p style={{fontSize:12,color:C.txt("muted")}}>No mapped registers found for selected machine.</p>
              </div>
            ):(
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                      {["Signal","Device/Register","Direction","Purpose","Live Value","Status","Write Value","Actions"].map((h)=>(
                        <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.09em",color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r,i)=>{
                      const regNo = toIntOrNull(r.register);
                      const regKey = String(regNo ?? "");
                      const device = String(r.device || selectedMachine?.plcSlmpDevice || "D").toUpperCase();
                      const isWritable = Boolean(r.writable) && regNo!==null && regNo>0 && canControl;
                      return (
                        <tr key={`${r.signalKey||r.signal||"row"}-${regKey}-${i}`} style={{borderBottom:`1px solid ${C.bdr()}`,background:i%2===1?C.bg("surf"):"transparent"}}>
                          <td style={{padding:"9px 12px",fontWeight:700,color:C.txt("pri")}}>{r.signal||r.signalKey||"—"}</td>
                          <td style={{padding:"9px 12px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.steel()}}>
                            {regNo===null?"—":`${device}${regNo}`}
                          </td>
                          <td style={{padding:"9px 12px",fontSize:11,color:C.txt("muted")}}>{r.direction||"—"}</td>
                          <td style={{padding:"9px 12px",fontSize:11,color:C.txt("muted"),maxWidth:220}}>
                            <div style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                              {r.description || "—"}
                            </div>
                          </td>
                          <td style={{padding:"9px 12px",fontFamily:"'DM Mono',monospace",fontWeight:800,color:C.txt("pri")}}>
                            {r.currentValue===null||r.currentValue===undefined?"—":String(r.currentValue)}
                          </td>
                          <td style={{padding:"9px 12px"}}>
                            <Badge
                              variant={r.tone==="good"?"ok":r.tone==="error"?"ng":r.tone==="warn"?"wip":"idle"}
                              label={r.status||"—"}
                            />
                          </td>
                          <td style={{padding:"9px 12px",minWidth:120}}>
                            <input
                              value={mappedWriteDraft[regKey] ?? ""}
                              onChange={(e)=>updateMappedDraft(regNo, e.target.value)}
                              placeholder="0"
                              disabled={!isWritable}
                              style={{...inp(false),height:32,fontSize:11,fontFamily:"'DM Mono',monospace",opacity:isWritable?1:0.5}}
                            />
                          </td>
                          <td style={{padding:"9px 12px"}}>
                            <div style={{display:"flex",gap:6}}>
                              <Btn size="sm" variant="steel" disabled={regNo===null||acting.reading} loading={acting.reading && mappedReadKey===`${String(r.signalKey||r.signal||"").toUpperCase()}_${regNo}`} onClick={()=>handleMappedRead(r)}>
                                <RefreshCw size={11}/> Read
                              </Btn>
                              <Btn size="sm" variant="ok" disabled={!isWritable||acting.writing} loading={isWritable&&acting.writing&&mappedWriteKey===`${String(r.signalKey||r.signal||"").toUpperCase()}_${regNo}`} onClick={()=>handleMappedWrite(r)}>
                                <Save size={11}/> Write
                              </Btn>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SCard>
        </div>
      )}

    

      {/* ══ TAB: Connection Log ═══════════════════════════════════ */}
      {activeTab==="logs" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {snapshot?.latestOperation?(
            <SCard title="Latest Scan Event" subtitle="Most Recent">
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>
                {[
                  {label:"Part Serial",value:snapshot.latestOperation.partId||"—",mono:true},
                  {label:"PLC Status", value:snapshot.latestOperation.plcStatus||"—"},
                  {label:"Result",     value:snapshot.latestOperation.result||"—",
                    variant:snapshot.latestOperation.result==="OK"?"ok":snapshot.latestOperation.result==="NG"?"ng":"wip"},
                  {label:"Time",       value:fmtTime(snapshot.latestOperation.createdAt),mono:true},
                ].map((k,i)=>(
                  <div key={i} style={{background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                    borderRadius:9,padding:"11px 13px"}}>
                    <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                      letterSpacing:"0.09em",color:C.txt("muted"),marginBottom:5}}>{k.label}</p>
                    {k.variant
                      ?<Badge variant={k.variant} label={k.value}/>
                      :<p style={{fontSize:13,fontWeight:700,
                          fontFamily:k.mono?"'DM Mono',monospace":"inherit",
                          color:C.txt("pri"),overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {k.value}
                        </p>}
                  </div>
                ))}
              </div>
            </SCard>
          ):(
            <div style={{padding:"28px 20px",textAlign:"center",
              background:C.bg("card"),border:`1px solid ${C.bdr()}`,
              borderRadius:14,color:C.txt("muted"),fontSize:12}}>
              No recent scan activity for this machine.
            </div>
          )}
          <SCard title="PLC Connection" subtitle="Network Status">
            {hasPlcError?(
              <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"13px 15px",
                borderRadius:9,
                background:plcErrorIsWarning ? C.amber(0.08) : C.ng(0.07),
                border:`1px solid ${plcErrorIsWarning ? C.amber(0.28) : C.ng(0.22)}`}}>
                <Unplug size={16} color={plcErrorIsWarning ? C.amber() : C.ng()} style={{flexShrink:0,marginTop:1}}/>
                <div>
                  <p style={{fontSize:12,fontWeight:700,color:plcErrorIsWarning ? C.amber() : C.ng(),marginBottom:3}}>
                    {plcErrorIsWarning ? "Read Warning" : "Connection Error"}
                  </p>
                  <p style={{fontSize:11,color:(plcErrorIsWarning ? C.amber(0.9) : C.ng(0.8)),lineHeight:1.5,fontFamily:"'DM Mono',monospace"}}>
                    {snapshot.plcConnection.error}
                  </p>
                  <p style={{fontSize:11,color:C.txt("muted"),marginTop:5}}>
                    {plcErrorIsWarning
                      ? "PLC network is reachable. Verify register mapping/device/frame settings."
                      : "Check the PLC IP address, port, and network connectivity."}
                  </p>
                </div>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"13px 15px",
                borderRadius:9,background:C.ok(0.07),border:`1px solid ${C.ok(0.22)}`}}>
                <CheckCircle2 size={16} color={C.ok()} style={{flexShrink:0,marginTop:1}}/>
                <div>
                  <p style={{fontSize:12,fontWeight:700,color:C.ok(),marginBottom:3}}>Connection Stable</p>
                  <p style={{fontSize:11,color:C.ok(0.85),lineHeight:1.5}}>
                    TCP link verified over {protocol} at {plcIp}:{plcPort}
                  </p>
                  <p style={{fontSize:10,color:C.txt("muted"),marginTop:4,fontFamily:"'DM Mono',monospace"}}>
                    Last checked: {fmtDT(snapshot?.plcConnection?.checkedAt)||fmtDT(new Date())}
                  </p>
                </div>
              </div>
            )}
          </SCard>
          {Array.isArray(snapshot?.recentLogs)&&snapshot.recentLogs.length>0&&(
            <SCard title="Recent Scan Log" subtitle="History" noPad>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                      {["Part Serial","Station","Signal","Result","Time"].map(h=>(
                        <th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:9,
                          fontWeight:800,textTransform:"uppercase",letterSpacing:"0.09em",
                          color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.recentLogs.slice(0,20).map((lg,i)=>(
                      <tr key={i} style={{borderBottom:`1px solid ${C.bdr()}`,
                        background:i%2===1?C.bg("surf"):"transparent"}}>
                        <td style={{padding:"9px 14px",fontFamily:"'DM Mono',monospace",
                          fontSize:11,fontWeight:700,color:C.txt("pri")}}>{lg.partId||"—"}</td>
                        <td style={{padding:"9px 14px",fontSize:11,color:C.txt("sec")}}>{lg.stationNo||"—"}</td>
                        <td style={{padding:"9px 14px",fontSize:11,fontFamily:"'DM Mono',monospace",color:C.txt("muted")}}>{lg.signalKey||"—"}</td>
                        <td style={{padding:"9px 14px"}}>
                          <Badge variant={lg.result==="OK"?"ok":lg.result==="NG"?"ng":"idle"}
                            label={lg.result==="OK"?"Pass":lg.result==="NG"?"Fail":"—"}/>
                        </td>
                        <td style={{padding:"9px 14px",fontSize:11,fontFamily:"'DM Mono',monospace",color:C.txt("muted")}}>
                          {fmtTime(lg.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SCard>
          )}
          {actionLogs.length>0&&(
            <SCard title="Manual PLC Test Log" subtitle="Sent vs Received" noPad>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                      {["Time","Action","Status","Request","Response / Error"].map(h=>(
                        <th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.09em",color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {actionLogs.map((lg,i)=>(
                      <tr key={i} style={{borderBottom:`1px solid ${C.bdr()}`,background:i%2===1?C.bg("surf"):"transparent"}}>
                        <td style={{padding:"9px 14px",fontSize:11,fontFamily:"'DM Mono',monospace",color:C.txt("muted")}}>{fmtTime(lg.at)}</td>
                        <td style={{padding:"9px 14px",fontSize:11,fontFamily:"'DM Mono',monospace",color:C.txt("pri")}}>{lg.action}</td>
                        <td style={{padding:"9px 14px"}}><Badge variant={lg.ok?"ok":"ng"} label={lg.ok?"OK":"FAIL"}/></td>
                        <td style={{padding:"9px 14px",fontSize:10,fontFamily:"'DM Mono',monospace",color:C.txt("sec"),maxWidth:260,wordBreak:"break-all"}}>{JSON.stringify(lg.request||{})}</td>
                        <td style={{padding:"9px 14px",fontSize:10,fontFamily:"'DM Mono',monospace",color:lg.ok?C.ok(0.9):C.ng(0.9),maxWidth:360,wordBreak:"break-all"}}>{lg.ok?JSON.stringify(lg.response||{}):String(lg.error||"Failed")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SCard>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={showResetConfirm}
        title="Confirm PLC Reset"
        message={`Send reset signal to PLC for machine "${selectedMachine?.machineName || "-"}"?`}
        confirmText={acting.resetting ? "Resetting..." : "Confirm Reset"}
        cancelText="Cancel"
        variant="danger"
        onConfirm={async () => {
          if (acting.resetting) return;
          await handleReset();
          setShowResetConfirm(false);
        }}
        onCancel={() => {
          if (acting.resetting) return;
          setShowResetConfirm(false);
        }}
      />
    </div>
  );
};

export default IoMonitor;


