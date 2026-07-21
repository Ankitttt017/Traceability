// ============================================================
//  Packing.jsx — IndusTrace Premium Packing Station
//  ✓ Enhanced Professional Design
//  ✓ Interactive Animations & Visual Feedback
//  ✓ Improved Tooltip System
//  ✓ Modern UI Components
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_OPTIONS, SOCKET_URL } from "../constants/network";
import {
  Boxes, Printer, RefreshCw, ScanLine, CheckCircle2,
  Clock, Package, QrCode, X, AlertCircle,
  LayoutGrid, List, Zap, Radio, Eye, TrendingUp,
  ClipboardCheck, Award, Shield, Users, Activity,
  ArrowRight, Circle, ChevronRight, Sparkles,
} from "lucide-react";
import { packingApi } from "../api/services";
import { useLanguage } from "../context/LanguageContext";

// ── Design tokens ──────────────────────────────────────────────────────────
const DS = `
  @keyframes pkSpin   { to{transform:rotate(360deg)} }
  @keyframes pkFadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pkPulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
  @keyframes pkPing   { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.2);opacity:0} }
  @keyframes pkSlot   { from{opacity:0;transform:scale(.7)} to{opacity:1;transform:scale(1)} }
  @keyframes pkGlow   { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4)} 50%{box-shadow:0 0 16px 4px rgba(34,197,94,.25)} }
  @keyframes pkShimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
  @keyframes pkFloat  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
  @keyframes pkRipple { 0%{transform:scale(1);opacity:.4} 100%{transform:scale(1.8);opacity:0} }
  
  :root{
    --pk-navy:  26,50,99;   --pk-steel: 84,119,146;
    --pk-amber: 250,185,91; --pk-linen: 232,226,219;
    --pk-ok:    34,197,94;  --pk-ng:    239,68,68;
    --pk-wip:   249,115,22; --pk-idle:  148,163,184;
    --pk-gold:  218,165,32;
  }
  [data-theme="light"]{
    --pk-bg-card:255,255,255; --pk-bg-surf:240,236,230;
    --pk-bg-input:255,255,255; --pk-bg-slot:248,246,243;
    --pk-txt-pri:26,50,99; --pk-txt-sec:84,119,146;
    --pk-txt-muted:140,160,180;
    --pk-bdr:84,119,146; --pk-bop:0.13;
    --pk-shadow:0 2px 12px rgba(26,50,99,.08);
    --pk-shadow-hover:0 8px 30px rgba(26,50,99,.15);
  }
  [data-theme="dark"]{
    --pk-bg-card:20,34,62; --pk-bg-surf:16,26,50;
    --pk-bg-input:14,22,44; --pk-bg-slot:12,20,42;
    --pk-txt-pri:232,226,219; --pk-txt-sec:120,160,190;
    --pk-txt-muted:84,119,146;
    --pk-bdr:84,119,146; --pk-bop:0.18;
    --pk-shadow:0 2px 12px rgba(0,0,0,.25);
    --pk-shadow-hover:0 8px 30px rgba(0,0,0,.35);
  }
  .pk-gradient-text {
    background: linear-gradient(135deg, rgb(var(--pk-amber)), #f6b83d);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .pk-glow-ring {
    animation: pkGlow 2s ease-in-out infinite;
  }
  .pk-float {
    animation: pkFloat 3s ease-in-out infinite;
  }
  .pk-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: pkShimmer 2s ease-in-out infinite;
  }
  @media (max-width: 768px) {
    .pk-header-main { flex-direction: column !important; align-items: stretch !important; }
    .pk-header-actions { justify-content: space-between !important; flex-wrap: wrap !important; }
    .pk-box-grid { grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)) !important; gap: 6px !important; }
    .pk-main-layout { grid-template-columns: 1fr !important; }
    .pk-progress-strip { flex-direction: column !important; align-items: stretch !important; }
    .pk-box-selector { width: 100%; justify-content: space-between !important; }
    .pk-stats-grid { grid-template-columns: repeat(2,1fr) !important; }
  }
  @media (max-width: 480px) {
    .pk-box-grid { grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)) !important; gap: 4px !important; }
    .pk-header-title h1 { font-size: 14px !important; }
    .pk-stats-grid { grid-template-columns: 1fr 1fr !important; gap: 6px !important; }
  }
`;
let _pkDS=false;
function injectDS(){
  if(_pkDS||typeof document==="undefined")return;_pkDS=true;
  const el=document.createElement("style");el.textContent=DS;document.head.appendChild(el);
  if(!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme","dark");
}

const C={
  navy: (o=1)=>`rgba(var(--pk-navy),${o})`,
  steel:(o=1)=>`rgba(var(--pk-steel),${o})`,
  amber:(o=1)=>`rgba(var(--pk-amber),${o})`,
  linen:(o=1)=>`rgba(var(--pk-linen),${o})`,
  ok:   (o=1)=>`rgba(var(--pk-ok),${o})`,
  ng:   (o=1)=>`rgba(var(--pk-ng),${o})`,
  wip:  (o=1)=>`rgba(var(--pk-wip),${o})`,
  idle: (o=1)=>`rgba(var(--pk-idle),${o})`,
  gold: (o=1)=>`rgba(var(--pk-gold),${o})`,
  bg:   (v="card") =>`rgb(var(--pk-bg-${v}))`,
  txt:  (v="pri")  =>`rgb(var(--pk-txt-${v}))`,
  bdr:  (o)        =>`rgba(var(--pk-bdr),${o||"var(--pk-bop)"})`,
};
const SH =`var(--pk-shadow)`;
const SHM=`var(--pk-shadow-hover)`;

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(v){if(!v)return"—";const d=new Date(v);return isNaN(d)?"—":d.toLocaleTimeString();}
function fmtDT(v){if(!v)return"—";const d=new Date(v);return isNaN(d)?"—":d.toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});}
function fmtDuration(start,end){
  if(!start)return"—";
  const s=new Date(start),e=end?new Date(end):new Date();
  const diff=Math.floor((e-s)/1000);
  if(diff<60)return `${diff}s`;
  if(diff<3600)return `${Math.floor(diff/60)}m ${diff%60}s`;
  return `${Math.floor(diff/3600)}h ${Math.floor((diff%3600)/60)}m`;
}

// ── Code 39 Barcode ────────────────────────────────────────────────────────
const CODE39={
  "0":"nnnwwnwnn","1":"wnnwnnnnw","2":"nnwwnnnnw","3":"wnwwnnnnn","4":"nnnwwnnnw",
  "5":"wnnwwnnnn","6":"nnwwwnnnn","7":"nnnwnnwnw","8":"wnnwnnwnn","9":"nnwwnnwnn",
  A:"wnnnnnwnnw",B:"nnwnnwnnw",C:"wnwnnwnnn",D:"nnnnwwnnw",E:"wnnnwwnnn",
  F:"nnwnwwnnn",G:"nnnnnwwnw",H:"wnnnnwwnn",I:"nnwnnwwnn",J:"nnnnwwwnn",
  K:"wnnnnnnww",L:"nnwnnnnww",M:"wnwnnnnwn",N:"nnnnwnnww",O:"wnnnwnnwn",
  P:"nnwnwnnwn",Q:"nnnnnnwww",R:"wnnnnnwwn",S:"nnwnnnwwn",T:"nnnnwnwwn",
  U:"wwnnnnnnw",V:"nwwnnnnnw",W:"wwwnnnnnn",X:"nwnnwnnnw",Y:"wwnnwnnnn",
  Z:"nwwnwnnnn","-":"nwnnnnwnw",".":"wwnnnnwnn"," ":"nwwnnnwnn","*":"nwnnwnwnn",
};
function toBars(value){
  const s=String(value||"").toUpperCase().replace(/[^0-9A-Z. -]/g,"");
  const enc=`*${s||"X"}*`;
  const segs=[{isBar:false,width:8}];
  for(let ci=0;ci<enc.length;ci++){
    const p=CODE39[enc[ci]];if(!p)continue;
    for(let bi=0;bi<p.length;bi++)
      segs.push({isBar:bi%2===0,width:p[bi]==="w"?3:1});
    if(ci<enc.length-1)segs.push({isBar:false,width:1});
  }
  segs.push({isBar:false,width:8});
  return segs;
}

// ── QR Code Generator ────────────────────────────────────────────────────
function generateQRMatrix(text,size=25){
  let hash=0;
  for(let i=0;i<text.length;i++){hash=((hash<<5)-hash)+text.charCodeAt(i);hash|=0;}
  const mat=Array.from({length:size},()=>new Array(size).fill(0));
  const finder=(r,c)=>{
    for(let i=0;i<7;i++)for(let j=0;j<7;j++){
      if(i===0||i===6||j===0||j===6)mat[r+i][c+j]=1;
      else if(i>=2&&i<=4&&j>=2&&j<=4)mat[r+i][c+j]=1;
      else mat[r+i][c+j]=0;
    }
  };
  finder(0,0);finder(0,size-7);finder(size-7,0);
  for(let i=8;i<size-8;i++){mat[6][i]=i%2===0?1:0;mat[i][6]=i%2===0?1:0;}
  for(let i=0;i<8;i++){mat[7][i]=0;mat[i][7]=0;mat[7][size-1-i]=0;mat[size-8][i]=0;}
  let bit=0;
  for(let r=size-1;r>=1;r-=2){
    if(r===6)r=5;
    for(let rr=size-1;rr>=0;rr--){
      for(let cc=0;cc<2;cc++){
        const c=r-cc;
        if(c<0||c>=size)continue;
        const inFinder=(r<9&&c<9)||(r<9&&c>=size-8)||(r>=size-8&&c<9)||(r===6||c===6);
        if(!inFinder){
          const byteIdx=Math.floor(bit/8),bitIdx=7-(bit%8);
          const hb=(hash>>(byteIdx%32))&0xff;
          mat[rr][c]=((hb>>bitIdx)&1);
          bit++;
        }
      }
    }
  }
  return mat;
}

// ── QR Code SVG Component ──────────────────────────────────────────────────
const QRCodeSVG=({value,size=140,fgColor="#000",bgColor="#fff"})=>{
  const mat=useMemo(()=>generateQRMatrix(value),[value]);
  const n=mat.length;
  const cell=Math.floor(size/n);
  const pad=Math.floor((size-cell*n)/2);
  return(
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg" style={{display:"block",shapeRendering:"crispEdges"}}>
      <rect width={size} height={size} fill={bgColor}/>
      {mat.map((row,r)=>row.map((v,c)=>v?
        <rect key={`${r}-${c}`} x={pad+c*cell} y={pad+r*cell} width={cell} height={cell} fill={fgColor}/>
        :null
      ))}
    </svg>
  );
};

// ── Print handler ──────────────────────────────────────────────────────────
function printBoxLabel(session,items,t){
  if(!session)return;
  const labelCode=session.labelCode||session.boxNumber;

  const mat=generateQRMatrix(labelCode);
  const n=mat.length,cell=4,pad=4,qSize=n*cell+pad*2;
  const qRects=mat.map((row,r)=>row.map((v,c)=>v?`<rect x="${pad+c*cell}" y="${pad+r*cell}" width="${cell}" height="${cell}" fill="#1a3263"/>`:"").join("")).join("");
  const qSvg=`<svg width="${qSize}" height="${qSize}" viewBox="0 0 ${qSize} ${qSize}" xmlns="http://www.w3.org/2000/svg" style="shape-rendering:crispEdges"><rect width="${qSize}" height="${qSize}" fill="#fff"/>${qRects}</svg>`;

  const partsRows=(items||[]).map((item,i)=>`
    <tr>
      <td style="color:#94a3b8;font-size:9px;padding:5px 8px;">${i+1}</td>
      <td style="font-family:monospace;font-weight:700;color:#547792;padding:5px 8px;">${item.slotNo||"—"}</td>
      <td style="font-family:monospace;font-weight:700;color:#1a3263;padding:5px 8px;">${item.partId||"—"}</td>
      <td style="font-family:monospace;color:#374151;padding:5px 8px;">${item.customerQrCode||"-"}</td>
      <td style="color:#374151;padding:5px 8px;">${item.stationNo||item.operationNo||"-"}</td>
      <td style="font-family:monospace;font-size:9px;color:#6b7280;padding:5px 8px;">${item.packedAt?new Date(item.packedAt).toLocaleString():"—"}</td>
    </tr>`).join("");

  const html=`<!DOCTYPE html><html><head>
<meta charset="UTF-8"/><title>${t?.("packing.packingLabel", "Packing Label") || "Packing Label"} — ${session.boxNumber}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Segoe UI',Arial,sans-serif;background:#f8fafc;color:#0f172a;font-size:11px}
.page{max-width:920px;margin:0 auto;padding:20px 26px}
.hdr{background:linear-gradient(135deg,#1a3263,#547792);color:#fff;padding:20px 28px;border-radius:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
.hdr h1{font-size:20px;font-weight:900;margin-bottom:3px;letter-spacing:-0.02em}
.hdr p{opacity:.8;font-size:11px}
.certified{background:rgba(250,185,91,.2);border:1px solid rgba(250,185,91,.5);color:#FAB95B;padding:5px 14px;border-radius:99px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}
.label-area{display:flex;gap:20px;margin-bottom:18px}
.qr-col{background:#fff;border:2px solid #1a3263;border-radius:14px;padding:16px 14px;display:flex;flex-direction:column;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.meta-col{flex:1}
.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.meta-item{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.lbl{font-size:7px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:3px}
.val{font-size:16px;font-weight:900;font-family:monospace;color:#1a3263}
table{width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden}
thead tr{background:linear-gradient(135deg,#1a3263,#2d4a7a);color:#fff}
thead th{padding:8px 10px;text-align:left;font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
tbody td{padding:7px 10px;border-bottom:1px solid #f1f5f9}
tbody tr:hover{background:#f8fafc}
.footer{margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:7px;color:#94a3b8}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><div class="page">
<div class="hdr"><div><h1>📦 ${t?.("packing.certifiedPackingList", "Certified Packing List") || "Certified Packing List"}</h1><p>🏭 IndusTrace MES — ${t?.("packing.finalGoodsRegistry", "Final Goods Registry") || "Final Goods Registry"}</p></div><div class="certified">✓ ${t?.("packing.qualityCertified", "Quality Certified") || "Quality Certified"}</div></div>
<div class="label-area"><div class="qr-col">${qSvg}<div style="font-family:monospace;font-size:11px;font-weight:900;color:#1a3263">${labelCode}</div></div>
<div class="meta-col"><div class="meta-grid">
<div class="meta-item"><div class="lbl">${t?.("packing.boxId", "Box ID") || "Box ID"}</div><div class="val">${session.boxNumber}</div></div>
<div class="meta-item"><div class="lbl">${t?.("packing.packed", "Packed") || "Packed"}</div><div class="val" style="color:#22C55E">${items.length} / ${session.capacity}</div></div>
<div class="meta-item"><div class="lbl">${t?.("packing.status", "Status") || "Status"}</div><div class="val" style="color:#22C55E">${t?.(`packing.${String(session.status || "OPEN").trim().toLowerCase()}`, String(session.status || "OPEN")) || String(session.status || "OPEN")}</div></div>
</div></div></div>
<div style="border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)"><table><thead><tr><th>#</th><th>${t?.("packing.slot", "Slot") || "Slot"}</th><th>${t?.("packing.partSerial", "Part Serial") || "Part Serial"}</th><th>${t?.("packing.customerQr", "Customer QR") || "Customer QR"}</th><th>${t?.("packing.station", "Station") || "Station"}</th><th>${t?.("packing.packedAt", "Packed At") || "Packed At"}</th></tr></thead><tbody>${partsRows}</tbody></table></div>
<div class="footer"><span>🏷️ ${t?.("packing.box", "Box") || "Box"}: ${session.boxNumber}</span><span>🖨️ ${t?.("packing.printed", "Printed") || "Printed"}: ${new Date().toLocaleString()}</span></div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},700);}</script>
</body></html>`;

  const w=window.open("","_blank","width=1020,height=780");
  if(!w){alert(t?.("packing.allowPopups", "Allow popups to print label.") || "Allow popups to print label.");return;}
  w.document.write(html);w.document.close();
}

// ── Enhanced Atoms ─────────────────────────────────────────────────────────

const Card = ({ title, subtitle, icon: Icon, accent, right, children, noPad, className = "" }) => (
  <div style={{
    background: C.bg("card"),
    border: `1px solid ${C.bdr()}`,
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: SH,
    borderTop: accent ? `3px solid ${accent}` : "none",
    transition: "box-shadow .2s ease, transform .15s ease",
    position: "relative",
  }}>
    {(title || right) && (
      <div style={{
        padding: "14px 20px",
        borderBottom: `1px solid ${C.bdr()}`,
        background: C.bg("surf"),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {Icon && (
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: C.navy(0.08),
              border: `1px solid ${C.navy(0.12)}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Icon size={14} color={C.steel()} />
            </div>
          )}
          <div>
            {subtitle && (
              <p style={{
                fontSize: 9,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: C.txt("muted"),
                marginBottom: 2,
              }}>{subtitle}</p>
            )}
            <p style={{
              fontSize: 14,
              fontWeight: 700,
              color: C.txt("pri"),
              letterSpacing: "-0.01em",
            }}>{title}</p>
          </div>
        </div>
        {right}
      </div>
    )}
    <div style={noPad ? {} : { padding: "18px 20px" }}>{children}</div>
  </div>
);

const Badge = ({ v = "idle", l, pulse, size = "md" }) => {
  const map = {
    ok: { fg: C.ok(), bg: C.ok(0.1), bd: C.ok(0.25), icon: "✓" },
    ng: { fg: C.ng(), bg: C.ng(0.1), bd: C.ng(0.25), icon: "✗" },
    wip: { fg: C.wip(), bg: C.wip(0.1), bd: C.wip(0.25), icon: "⟳" },
    idle: { fg: C.idle(), bg: C.idle(0.08), bd: C.idle(0.2), icon: "○" },
    amber: { fg: C.amber(), bg: C.amber(0.12), bd: C.amber(0.3), icon: "●" },
    gold: { fg: C.gold(), bg: C.gold(0.1), bd: C.gold(0.25), icon: "★" },
  };
  const s = map[v] || map.idle;
  const fontSize = size === "sm" ? 10 : size === "lg" ? 13 : 11;
  const padding = size === "sm" ? "2px 8px" : size === "lg" ? "4px 14px" : "3px 11px";
  
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding,
      borderRadius: 99,
      fontSize,
      fontWeight: 700,
      color: s.fg,
      background: s.bg,
      border: `1px solid ${s.bd}`,
      whiteSpace: "nowrap",
      transition: "all .2s ease",
      boxShadow: pulse ? `0 0 12px ${s.fg}30` : "none",
    }}>
      <span style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: s.fg,
        flexShrink: 0,
        animation: pulse ? "pkPulse 1.4s ease-in-out infinite" : "none",
        boxShadow: pulse ? `0 0 8px ${s.fg}60` : "none",
      }} />
      {l}
    </span>
  );
};

const ProgressBar = ({ value, max, label }) => {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const color = pct >= 90 ? C.ok() : pct >= 50 ? C.amber() : C.steel();
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.txt("muted"), marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{
        height: 8,
        borderRadius: 99,
        background: C.bdr(0.12),
        overflow: "hidden",
        position: "relative",
      }}>
        <div style={{
          height: "100%",
          background: `linear-gradient(90deg, ${C.navy(0.4)}, ${color})`,
          width: `${pct}%`,
          transition: "width .6s cubic-bezier(.22,1,.36,1)",
          borderRadius: 99,
          boxShadow: `0 0 12px ${color}30`,
        }} />
      </div>
    </div>
  );
};

// ── Scan Input Hook ────────────────────────────────────────────────────────
function useScanInput(onScan){
  const bufRef=useRef(""),timerRef=useRef(null);
  useEffect(()=>{
    const onKey=(e)=>{
      if(e.key==="Enter"){
        const val=bufRef.current.trim();
        bufRef.current="";
        if(timerRef.current){clearTimeout(timerRef.current);timerRef.current=null;}
        if(val.length>=3)onScan(val);
        return;
      }
      if(e.key.length===1){
        bufRef.current+=e.key;
        if(timerRef.current)clearTimeout(timerRef.current);
        timerRef.current=setTimeout(()=>{bufRef.current="";},300);
      }
    };
    window.addEventListener("keydown",onKey);
    return()=>{window.removeEventListener("keydown",onKey);if(timerRef.current)clearTimeout(timerRef.current);};
  },[onScan]);
}

function normalizeScanValue(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

// ══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
const Packing=()=>{
  injectDS();
  const { t } = useLanguage();
  const translateSessionStatus = useCallback((status) => {
    const normalized = String(status || "OPEN").trim().toUpperCase();
    if (normalized === "OPEN") return t("packing.open", "Open");
    if (normalized === "CLOSED") return t("packing.closed", "Closed");
    if (normalized === "ACTIVE") return t("packing.active", "Active");
    return normalized || "OPEN";
  }, [t]);

  const[overview,    setOverview]    =useState({activeSession:null,activeItems:[],recentSessions:[],finalPackingStations:[],managementSettings:null});
  const[selectedBox, setSelectedBox]  =useState("");
  const[selectedSess,setSelectedSess]=useState(null);
  const[popup,       setPopup]       =useState(null);
  const[loadingOv,   setLoadingOv]   =useState(true);
  const[loadingSess, setLoadingSess] =useState(false);
  const[hoveredSlot, setHoveredSlot] =useState(null);
  const[tooltipPos,  setTooltipPos]  =useState({x:0,y:0});
  const[view,        setView]        =useState("grid");
  const[scanFlash,   setScanFlash]   =useState(false);
  const[scanResult,  setScanResult]  =useState(null);
  const[showQRModal, setShowQRModal] =useState(false);
  const selectedBoxRef=useRef("");
  const popupTimerRef=useRef(null);

  const activeSession=overview.activeSession;
  const activeItems  =useMemo(()=>overview.activeItems||[],[overview.activeItems]);
  const selectedItems=useMemo(()=>selectedSess?.items||[],[selectedSess?.items]);

  const displaySess=selectedSess||activeSession;
  const displayItems=useMemo(()=>{
    if(!displaySess)return[];
    if(activeSession&&Number(displaySess.id)===Number(activeSession.id))
      return activeItems.map(i=>({...i,qrCode:i.qrCode||i.customerQrCode||i.partId,packedAt:i.packedAt||i.createdAt}));
    return selectedItems;
  },[displaySess,activeSession,activeItems,selectedItems]);

  const capacity     =Math.max(Number(displaySess?.capacity||64),1);
  const filledCount  =Number(displaySess?.packedCount||displayItems.length||0);
  const progressPct  =Math.min(100,Math.round((filledCount/capacity)*100));
  const fillColor    =progressPct>=90?C.ok():progressPct>=50?C.amber():C.steel();

  const filledMap=useMemo(()=>{
    const m=new Map();
    displayItems.forEach(it=>m.set(Number(it.slotNo),it));
    return m;
  },[displayItems]);
  const tooltipItem=hoveredSlot?filledMap.get(Number(hoveredSlot)):null;
  const tooltipSlot=tooltipItem?hoveredSlot:null;
  const tooltipFlips=typeof window!=="undefined"&&tooltipPos.x>window.innerWidth-320;

  const updateTooltipPosition=useCallback((event)=>{
    setTooltipPos({x:event.clientX,y:event.clientY});
  },[]);

  const handleSlotMouseEnter=useCallback((slotId,event)=>{
    setHoveredSlot(slotId);
    setTooltipPos({x:event.clientX,y:event.clientY});
  },[]);

  const loadSession=useCallback(async(boxNumber)=>{
    const n=String(boxNumber||"").trim().toUpperCase();
    if(!n){setSelectedSess(null);return;}
    setLoadingSess(true);
    try{const d=await packingApi.boxByNumber(n);setSelectedSess(d||null);}
    catch{setSelectedSess(null);}
    finally{setLoadingSess(false);}
  },[]);

  const loadOverview=useCallback(async(preferred="")=>{
    setLoadingOv(true);
    try{
      const d=await packingApi.overview();setOverview(d);
      const target=preferred||d.activeSession?.boxNumber||d.recentSessions?.[0]?.boxNumber||"";
      if(target){setSelectedBox(target);selectedBoxRef.current=target;await loadSession(target);}
    }catch{}
    finally{setLoadingOv(false);}
  },[loadSession]);

  useEffect(()=>{loadOverview();},[loadOverview]);

  useEffect(()=>{
    if(!popup) return undefined;
    if(popupTimerRef.current) clearTimeout(popupTimerRef.current);
    popupTimerRef.current=setTimeout(()=>setPopup(null), popup.type==="ERROR" ? 5200 : 3200);
    return()=>{ if(popupTimerRef.current) clearTimeout(popupTimerRef.current); };
  },[popup]);

  const handlePackingScan=useCallback(async(rawScanned)=>{
    const scanned=normalizeScanValue(rawScanned).toUpperCase();
    if(!scanned || scanned.length<3) return;
    setScanFlash(true);setTimeout(()=>setScanFlash(false),800);
    const boxes=[activeSession?.boxNumber,...(overview.recentSessions||[]).map(s=>s.boxNumber)].filter(Boolean).map(v=>String(v).trim().toUpperCase());
    const matched=boxes.find(b=>scanned.includes(b)||b.includes(scanned)||scanned===b);
    if(matched){
      setSelectedBox(matched);selectedBoxRef.current=matched;
      loadSession(matched).then(()=>{
        setScanResult({boxNumber:matched,scannedAt:new Date().toISOString()});
      });
      return;
    }
    try{
      const packed=await packingApi.scan({
        boxNumber:selectedBoxRef.current||undefined,
        partId:scanned,
      });
      await loadOverview(selectedBoxRef.current||packed?.box?.boxNumber||"");
      setPopup({
        type:"SUCCESS",
        title:t("packing.packingReady", "✅ Packing Ready"),
        message:`${t("packing.packed", "📦 Packed")} ${packed?.resolvedPartId||packed?.item?.partId||scanned} ${t("packing.intoBox", "into")} ${packed?.box?.boxNumber||selectedBoxRef.current||t("packing.activeBox", "active box")}.`,
        subtitle:packed?.customerQrCode?`${t("packing.customerQr", "🔲 Customer QR")}: ${packed.customerQrCode}`:"",
      });
    }catch(error){
      const message=String(error?.response?.data?.error||error?.message||t("packing.scanFailed", "Packing scan failed"));
      setPopup({
        type:"ERROR",
        title:t("packing.packingBlocked", "⛔ Packing Blocked"),
        message,
        subtitle:scanned,
      });
    }
  },[activeSession?.boxNumber, overview.recentSessions, loadOverview, loadSession]);

  useScanInput(handlePackingScan);

  useEffect(()=>{
    const socket=io(SOCKET_URL,{
      ...SOCKET_OPTIONS,
      reconnection:true,
      reconnectionAttempts:Infinity,
      timeout:10000,
    });
    socket.on("packing_update",(payload={})=>{
      loadOverview(payload.boxNumber).catch(()=>{});
    });
    socket.on("operator_popup",(payload={})=>{
      const targetStation=String(payload.stationNo||payload.station_no||"").trim().toUpperCase();
      const sourceStation=String(payload.sourceStationNo||payload.source_station_no||"").trim().toUpperCase();
      const finalStations=(overview.finalPackingStations||[]).map(v=>String(v).trim().toUpperCase());
      const isPackingPopup=targetStation==="PACKING";
      const isFinalStationPopup=sourceStation && finalStations.includes(sourceStation);
      if(!isPackingPopup && !isFinalStationPopup) return;
      setPopup({
        type:String(payload.type||"INFO").toUpperCase()==="ERROR"?"ERROR":"SUCCESS",
        title:isFinalStationPopup?t("packing.readyForPacking", "📦 Ready For Packing"):t("packing.packingUpdate", "🔄 Packing Update"),
        message:String(payload.message||t("packing.statusUpdated", "Packing status updated")),
        subtitle:[payload.partId||payload.part_id, sourceStation||targetStation].filter(Boolean).join(" • "),
      });
      if(payload.partId || payload.part_id){
        loadOverview(selectedBoxRef.current||"").catch(()=>{});
      }
    });
    return()=>{
      socket.off("packing_update");
      socket.off("operator_popup");
      if (socket.connected) socket.disconnect();
    };
  },[loadOverview, overview.finalPackingStations]);

  const handleSelectBox=(e)=>{
    const v=e.target.value.toUpperCase();
    setSelectedBox(v);selectedBoxRef.current=v;loadSession(v);
  };

  const handlePrint=()=>{printBoxLabel(displaySess,displayItems,t);};

  const eff = displaySess?.createdAt
    ? (displayItems.length / Math.max(1, (Date.now() - new Date(displaySess.createdAt).getTime()) / 60000)).toFixed(1)
    : "—";

  const getBoxSize = () => {
    if (typeof window !== 'undefined') {
      const width = window.innerWidth;
      if (width <= 480) return capacity > 100 ? 34 : 40;
      if (width <= 768) return capacity > 100 ? 42 : 50;
    }
    if (capacity <= 36) return 70;
    if (capacity <= 64) return 56;
    if (capacity <= 100) return 46;
    return 40;
  };
  const [boxSize, setBoxSize] = useState(getBoxSize());
  useEffect(() => {
    const handleResize = () => setBoxSize(getBoxSize());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [capacity]);

  return(
    <div style={{
      display:"flex",
      flexDirection:"column",
      gap:20,
      paddingBottom:32,
      animation:"pkFadeIn .4s ease",
      outline:scanFlash?`3px solid ${C.ok()}`:"none",
      outlineOffset:2,
      transition:"outline .15s ease",
      borderRadius:6,
    }}>
      {/* ── Enhanced Popup Toast ─────────────────────────────────── */}
      {popup&&(
        <div style={{
          position:"fixed",
          top:20,
          right:20,
          zIndex:1350,
          maxWidth:440,
          width:"calc(100% - 40px)",
          animation:"pkFadeIn .25s ease",
        }}>
          <div style={{
            border:`1px solid ${popup.type==="ERROR"?C.ng(0.3):C.ok(0.3)}`,
            borderLeft:`4px solid ${popup.type==="ERROR"?C.ng():C.ok()}`,
            borderRadius:14,
            boxShadow:SHM,
            padding:"16px 18px",
            display:"flex",
            gap:14,
            alignItems:"flex-start",
            backdropFilter:"blur(12px)",
            background:popup.type==="ERROR" ? `rgba(var(--pk-bg-card),0.95)` : `rgba(var(--pk-bg-card),0.95)`,
          }}>
            <div style={{
              width:36,
              height:36,
              borderRadius:10,
              display:"flex",
              alignItems:"center",
              justifyContent:"center",
              flexShrink:0,
              background:popup.type==="ERROR"?C.ng(0.12):C.ok(0.12),
              border:`1px solid ${popup.type==="ERROR"?C.ng(0.2):C.ok(0.2)}`,
            }}>
              {popup.type==="ERROR"?<AlertCircle size={18} color={C.ng()}/>:<CheckCircle2 size={18} color={C.ok()}/>}
            </div>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:14,fontWeight:800,color:C.txt("pri"),marginBottom:3,letterSpacing:"-0.01em"}}>
                {popup.title}
              </div>
              <div style={{fontSize:12,color:C.txt("sec"),lineHeight:1.5}}>{popup.message}</div>
              {popup.subtitle&&(
                <div style={{
                  fontSize:10,
                  color:C.txt("muted"),
                  marginTop:6,
                  fontFamily:"'DM Mono',monospace",
                  padding:"4px 8px",
                  background:C.bg("surf"),
                  borderRadius:6,
                  border:`1px solid ${C.bdr()}`,
                  display:"inline-block",
                }}>{popup.subtitle}</div>
              )}
            </div>
            <button onClick={()=>setPopup(null)} style={{
              width:28,
              height:28,
              borderRadius:8,
              background:"none",
              border:`1px solid ${C.bdr()}`,
              color:C.txt("muted"),
              display:"flex",
              alignItems:"center",
              justifyContent:"center",
              cursor:"pointer",
              flexShrink:0,
              transition:"all .15s ease",
            }}>
              <X size={13}/>
            </button>
          </div>
        </div>
      )}

      {/* ── QR Scan Result Modal ─────────────────────────────────── */}
      {scanResult&&(
        <div style={{
          position:"fixed",
          inset:0,
          zIndex:1200,
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          padding:16,
          background:"rgba(0,0,0,0.75)",
          backdropFilter:"blur(8px)",
        }}>
          <div style={{
            width:"100%",
            maxWidth:480,
            background:C.bg("card"),
            border:`1px solid ${C.bdr()}`,
            borderRadius:20,
            overflow:"hidden",
            boxShadow:SHM,
            animation:"pkFadeIn .25s ease",
          }}>
            <div style={{
              height:4,
              background:`linear-gradient(90deg,${C.ok()},${C.amber()},${C.ok()})`,
            }}/>
            <div style={{
              padding:"16px 22px",
              borderBottom:`1px solid ${C.bdr()}`,
              background:C.bg("surf"),
              display:"flex",
              alignItems:"center",
              justifyContent:"space-between",
            }}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{
                  width:38,
                  height:38,
                  borderRadius:10,
                  background:C.ok(0.12),
                  border:`1px solid ${C.ok(0.25)}`,
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                }}>
                  <QrCode size={17} color={C.ok()}/>
                </div>
                <div>
                  <p style={{
                    fontSize:9,
                    fontWeight:800,
                    textTransform:"uppercase",
                    letterSpacing:"0.1em",
                    color:C.txt("muted"),
                    marginBottom:1,
                  }}>{t("packing.qrScanResult", "QR Scan Result")}</p>
                  <p style={{fontSize:14,fontWeight:700,color:C.ok(),letterSpacing:"-0.01em"}}>
                    {t("packing.boxFound", "🎯 Box Found")}
                  </p>
                </div>
              </div>
              <button onClick={()=>setScanResult(null)} style={{
                width:30,
                height:30,
                borderRadius:8,
                background:"none",
                border:`1px solid ${C.bdr()}`,
                cursor:"pointer",
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                color:C.txt("muted"),
                transition:"all .15s ease",
              }}>
                <X size={14}/>
              </button>
            </div>
            <div style={{padding:"20px 22px 24px"}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:18}}>
                {[
                  {label:t("packing.boxId", "📦 Box ID"), value:displaySess?.boxNumber||scanResult.boxNumber,mono:true},
                  {label:`${t("packing.packed", "📊 Packed")} / Total`,value:`${filledCount} / ${capacity}`,mono:true},
                  {label:t("packing.status", "📌 Status"), value:translateSessionStatus(displaySess?.status),mono:false},
                ].map((f,i)=>(
                  <div key={i} style={{
                    background:C.bg("surf"),
                    border:`1px solid ${C.bdr()}`,
                    borderRadius:10,
                    padding:"10px 12px",
                  }}>
                    <p style={{
                      fontSize:9,
                      fontWeight:800,
                      textTransform:"uppercase",
                      letterSpacing:"0.08em",
                      color:C.txt("muted"),
                      marginBottom:4,
                    }}>{f.label}</p>
                    <p style={{
                      fontSize:13,
                      fontWeight:700,
                      color:C.txt("pri"),
                      fontFamily:f.mono?"'DM Mono',monospace":"inherit",
                    }}>{f.value}</p>
                  </div>
                ))}
              </div>
              <ProgressBar value={filledCount} max={capacity} label={t("packing.fillLevel", "Fill Level")} />
              <div style={{display:"flex",gap:12,marginTop:18}}>
                <button onClick={()=>setScanResult(null)}
                  style={{
                    flex:1,
                    height:40,
                    borderRadius:10,
                    fontSize:12,
                    fontWeight:700,
                    cursor:"pointer",
                    background:"transparent",
                    border:`1px solid ${C.bdr()}`,
                    color:C.txt("sec"),
                    transition:"all .15s ease",
                  }}>{t("common.close", "✕ Close")}</button>
                <button onClick={()=>{setScanResult(null);handlePrint();}}
                  style={{
                    flex:2,
                    height:40,
                    borderRadius:10,
                    fontSize:12,
                    fontWeight:800,
                    cursor:"pointer",
                    background:C.amber(),
                    border:"none",
                    color:C.navy(),
                    display:"flex",
                    alignItems:"center",
                    justifyContent:"center",
                    gap:8,
                    boxShadow:`0 4px 16px ${C.amber(0.35)}`,
                    transition:"all .15s ease",
                  }}>
                  <Printer size={15}/> {t("packing.printLabel", "🖨️ Print Label")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal ────────────────────────────────────────── */}
      {showQRModal && displaySess && (
        <div style={{
          position:"fixed",
          inset:0,
          zIndex:1200,
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          padding:16,
          background:"rgba(0,0,0,0.75)",
          backdropFilter:"blur(8px)",
        }}>
          <div style={{
            width:"100%",
            maxWidth:440,
            background:C.bg("card"),
            border:`1px solid ${C.bdr()}`,
            borderRadius:20,
            overflow:"hidden",
            boxShadow:SHM,
            animation:"pkFadeIn .25s ease",
          }}>
            <div style={{
              height:4,
              background:`linear-gradient(90deg,${C.navy()},${C.amber()},${C.navy()})`,
            }}/>
            <div style={{
              padding:"16px 22px",
              borderBottom:`1px solid ${C.bdr()}`,
              background:C.bg("surf"),
              display:"flex",
              alignItems:"center",
              justifyContent:"space-between",
            }}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{
                  width:38,
                  height:38,
                  borderRadius:10,
                  background:C.amber(0.12),
                  border:`1px solid ${C.amber(0.25)}`,
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                }}>
                  <QrCode size={17} color={C.amber()}/>
                </div>
                <div>
                  <p style={{
                    fontSize:9,
                    fontWeight:800,
                    textTransform:"uppercase",
                    letterSpacing:"0.1em",
                    color:C.txt("muted"),
                    marginBottom:1,
                  }}>{t("packing.boxQrCode", "Box QR Code")}</p>
                  <p style={{fontSize:14,fontWeight:700,color:C.amber(),letterSpacing:"-0.01em"}}>
                    {t("packing.scanToVerify", "🔍 Scan to Verify")}
                  </p>
                </div>
              </div>
              <button onClick={()=>setShowQRModal(false)} style={{
                width:30,
                height:30,
                borderRadius:8,
                background:"none",
                border:`1px solid ${C.bdr()}`,
                cursor:"pointer",
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                color:C.txt("muted"),
                transition:"all .15s ease",
              }}>
                <X size={14}/>
              </button>
            </div>
            <div style={{padding:"28px 20px",textAlign:"center"}}>
              <div style={{
                background:"#ffffff",
                borderRadius:16,
                padding:20,
                display:"inline-block",
                boxShadow:`0 8px 32px rgba(0,0,0,0.15)`,
                marginBottom:16,
                border:`1px solid ${C.bdr(0.1)}`,
              }}>
                <QRCodeSVG
                  value={displaySess.labelCode||displaySess.boxNumber}
                  size={220}
                  fgColor="#1a3263"
                  bgColor="#ffffff"
                />
              </div>
              <p style={{
                fontFamily:"'DM Mono',monospace",
                fontSize:14,
                fontWeight:800,
                color:C.txt("pri"),
                marginBottom:6,
                letterSpacing:"0.06em",
              }}>
                {displaySess.labelCode||displaySess.boxNumber}
              </p>
              <p style={{fontSize:11,color:C.txt("muted"),maxWidth:300,margin:"0 auto"}}>
                🔎 Scan this QR code to view box contents and packing status
              </p>
              <button onClick={()=>setShowQRModal(false)}
                style={{
                  marginTop:20,
                  padding:"10px 28px",
                  borderRadius:10,
                  background:C.navy(),
                  border:"none",
                  color:C.linen(),
                  fontSize:12,
                  fontWeight:700,
                  cursor:"pointer",
                  transition:"all .15s ease",
                  boxShadow:`0 4px 16px ${C.navy(0.3)}`,
                }}>
                {t("common.close", "✕ Close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ HEADER ══════════════════════════════════════════════════ */}
      <div style={{
        background:C.bg("card"),
        border:`1px solid ${C.bdr()}`,
        borderRadius:16,
        overflow:"hidden",
        boxShadow:SH,
        position:"relative",
      }}>
        <div style={{
          height:4,
          background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()},${C.steel()},${C.navy()})`,
          backgroundSize:"200% 100%",
          animation:"pkShimmer 3s ease-in-out infinite",
        }}/>
        <div style={{padding:"16px 22px"}}>
          <div style={{
            display:"flex",
            alignItems:"center",
            justifyContent:"space-between",
            flexWrap:"wrap",
            gap:14,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{
                width:50,
                height:50,
                borderRadius:14,
                flexShrink:0,
                background:`linear-gradient(135deg,${C.navy()},${C.steel(0.85)})`,
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                boxShadow:`0 4px 16px ${C.navy(0.35)}`,
                position:"relative",
              }}>
                <Boxes size={22} color={C.linen()}/>
                <div style={{
                  position:"absolute",
                  top:-4,
                  right:-4,
                  width:16,
                  height:16,
                  borderRadius:"50%",
                  background:C.ok(),
                  border:`2px solid ${C.bg("card")}`,
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontSize:8,
                  color:"#fff",
                  fontWeight:900,
                }}>✓</div>
              </div>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <h1 style={{
                    fontSize:18,
                    fontWeight:800,
                    color:C.txt("pri"),
                    letterSpacing:"-0.02em",
                  }}>
                    {t("packing.finalPackingStation", "🏗️ Final Packing Station")}
                  </h1>
                  <Badge v="ok" l={t("packing.live", "● LIVE").toUpperCase()} pulse={true} size="sm" />
                </div>
                <p style={{
                  fontSize:11,
                  color:C.txt("muted"),
                  marginTop:3,
                  display:"flex",
                  alignItems:"center",
                  gap:6,
                }}>
                  <span>⚡ {t("packing.autoMappingEnabled", "Auto-mapping enabled")}</span>
                  <span style={{width:4,height:4,borderRadius:"50%",background:C.txt("muted")}}/>
                  <span>🔲 {t("packing.scanQrLookupBox", "Scan QR to lookup box")}</span>
                </p>
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              {/* QR Button */}
              <button onClick={()=>displaySess&&setShowQRModal(true)} disabled={!displaySess}
                style={{
                  width:38,
                  height:38,
                  borderRadius:10,
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  background:C.bg("surf"),
                  border:`1px solid ${C.bdr()}`,
                  cursor:displaySess?"pointer":"not-allowed",
                  color:C.txt("sec"),
                  opacity:displaySess?1:0.5,
                  transition:"all .15s ease",
                  position:"relative",
                }}
                title={t("packing.viewBoxQrCode", "View Box QR Code")}>
                <QrCode size={15}/>
              </button>

              {/* Box selector */}
              <div style={{
                display:"flex",
                alignItems:"center",
                gap:8,
                padding:"6px 14px",
                background:C.bg("surf"),
                border:`1px solid ${C.bdr()}`,
                borderRadius:10,
                transition:"all .15s ease",
              }}>
                <Package size={14} color={C.txt("muted")}/>
                <select value={selectedBox} onChange={handleSelectBox}
                  style={{
                    background:"transparent",
                    border:"none",
                    outline:"none",
                    fontSize:12,
                    fontWeight:700,
                    color:C.txt("pri"),
                    cursor:"pointer",
                    fontFamily:"'DM Mono',monospace",
                    padding:"4px 0",
                  }}>
                  {activeSession&&<option value={activeSession.boxNumber}>📦 {activeSession.boxNumber} — {t("packing.active", "Active").toUpperCase()}</option>}
                  {(overview.recentSessions||[]).map(s=><option key={s.id} value={s.boxNumber}>📋 {s.boxNumber} — {translateSessionStatus(s.status)}</option>)}
                  {!activeSession&&!(overview.recentSessions||[]).length&&<option value="">{t("packing.noBoxSessions", "No box sessions")}</option>}
                </select>
              </div>

              <button onClick={()=>loadOverview(selectedBox)} disabled={loadingOv}
                style={{
                  width:38,
                  height:38,
                  borderRadius:10,
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  background:"transparent",
                  border:`1px solid ${C.bdr()}`,
                  cursor:"pointer",
                  color:C.txt("sec"),
                  opacity:loadingOv?0.5:1,
                  transition:"all .15s ease",
                }}>
                <RefreshCw size={15} style={{animation:loadingOv?"pkSpin .9s linear infinite":"none"}}/>
              </button>

              <button onClick={handlePrint} disabled={!displaySess}
                style={{
                  display:"inline-flex",
                  alignItems:"center",
                  gap:8,
                  height:38,
                  padding:"0 18px",
                  borderRadius:10,
                  fontSize:12,
                  fontWeight:800,
                  cursor:displaySess?"pointer":"not-allowed",
                  background:displaySess?C.amber():C.idle(0.1),
                  border:"none",
                  color:displaySess?C.navy():C.txt("muted"),
                  boxShadow:displaySess?`0 4px 16px ${C.amber(0.35)}`:"none",
                  opacity:displaySess?1:0.5,
                  transition:"all .15s ease",
                }}>
                <Printer size={15}/> {t("packing.printLabel", "🖨️ Print")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ══ SCAN HINT BAR ═══════════════════════════════════════════ */}
      <div style={{
        display:"flex",
        alignItems:"center",
        gap:12,
        padding:"12px 18px",
        borderRadius:12,
        background:scanFlash?C.ok(0.1):C.bg("card"),
        border:`1px solid ${scanFlash?C.ok(0.35):C.bdr()}`,
        boxShadow:SH,
        transition:"all .25s ease",
        position:"relative",
        overflow:"hidden",
      }}>
        {scanFlash && (
          <div style={{
            position:"absolute",
            inset:0,
            background:`radial-gradient(circle at center, ${C.ok(0.08)}, transparent 70%)`,
            animation:"pkFadeIn .2s ease",
          }}/>
        )}
        <div style={{
          position:"relative",
          width:20,
          height:20,
          flexShrink:0,
        }}>
          <div style={{
            position:"absolute",
            inset:0,
            borderRadius:"50%",
            background:C.ok(0.3),
            animation:"pkPing 1.8s ease-out infinite",
          }}/>
          <div style={{
            width:20,
            height:20,
            borderRadius:"50%",
            background:C.ok(),
            position:"relative",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            boxShadow:`0 0 20px ${C.ok(0.3)}`,
          }}>
            <ScanLine size={11} color="#fff"/>
          </div>
        </div>
        <p style={{
          fontSize:12,
          fontWeight:600,
          color:scanFlash?C.ok():C.txt("muted"),
          transition:"color .2s ease",
          flex:1,
        }}>
          {scanFlash
            ? "✅ QR code detected — loading box details..."
            : "📸 Ready to scan — point any barcode or QR scanner at this screen"
          }
        </p>
        <div style={{
          display:"flex",
          gap:4,
          padding:"4px 10px",
          borderRadius:6,
          background:C.bdr(0.08),
          border:`1px solid ${C.bdr(0.1)}`,
        }}>
          <span style={{fontSize:9,fontWeight:700,color:C.txt("muted")}}>⌨️</span>
          <span style={{fontSize:9,fontWeight:600,color:C.txt("sec")}}>Scan</span>
        </div>
      </div>

      {/* ══ MAIN CONTENT ════════════════════════════════════════════ */}
      <div style={{
        display:"grid",
        gridTemplateColumns:"1fr 300px",
        gap:18,
        alignItems:"start",
      }} className="pk-main-layout">

        {/* ── Left: Box grid + ledger ──────────────────────────── */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Progress strip */}
          <div style={{
            background:C.bg("card"),
            border:`1px solid ${C.bdr()}`,
            borderRadius:14,
            padding:"14px 18px",
            boxShadow:SH,
          }}>
            <div style={{
              display:"flex",
              alignItems:"center",
              justifyContent:"space-between",
              marginBottom:10,
              flexWrap:"wrap",
              gap:10,
            }}>
              <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <span style={{fontSize:14,fontWeight:700,color:C.txt("pri"),letterSpacing:"-0.01em"}}>
                  📊 {t("packing.boxFillStatus", "Box Fill Status")}
                </span>
                <Badge
                  v={progressPct>=90?"ok":progressPct>=50?"amber":"idle"}
                  l={`${filledCount} / ${capacity} ${t("packing.packed", "Packed").toLowerCase()}`}
                  size="sm"
                />
              </div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{
                  fontSize:20,
                  fontWeight:900,
                  color:fillColor,
                  fontFamily:"'DM Mono',monospace",
                  letterSpacing:"-0.02em",
                }}>{progressPct}%</span>
                <div style={{
                  display:"flex",
                  gap:4,
                  padding:4,
                  background:C.bg("surf"),
                  border:`1px solid ${C.bdr()}`,
                  borderRadius:8,
                }}>
                  {[
                    {k:"grid",ic:<LayoutGrid size={13}/>},
                    {k:"list",ic:<List size={13}/>}
                  ].map(t=>(
                    <button key={t.k} onClick={()=>setView(t.k)}
                      style={{
                        width:30,
                        height:28,
                        borderRadius:6,
                        cursor:"pointer",
                        display:"flex",
                        alignItems:"center",
                        justifyContent:"center",
                        border:"none",
                        background:view===t.k?C.navy():"transparent",
                        color:view===t.k?C.linen():C.txt("muted"),
                        transition:"all .12s ease",
                      }}>
                      {t.ic}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <ProgressBar value={filledCount} max={capacity} label={t("packing.fillLevel", "Fill Level")} />
          </div>

          {/* Box Slot Grid */}
          <Card
            noPad
            title="📦 Box Slot Map"
            subtitle="🔲 Digital Twin"
            icon={LayoutGrid}
            accent={C.steel()}
            right={displaySess && (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{
                  fontSize:9,
                  color:C.txt("muted"),
                  display:"flex",
                  alignItems:"center",
                  gap:4,
                }}>
                  <Package size={12}/> <strong style={{fontFamily:"'DM Mono',monospace",color:C.txt("pri")}}>
                    {displaySess.boxNumber}
                  </strong>
                </span>
                <Badge
                  v={displaySess?.status==="CLOSED"?"ok":"wip"}
                  l={translateSessionStatus(displaySess?.status)}
                  size="sm"
                  pulse={displaySess?.status!=="CLOSED"}
                />
              </div>
            )}
          >
            {loadingOv||loadingSess?(
              <div style={{padding:"60px 24px",textAlign:"center"}}>
                <RefreshCw size={26} color={C.txt("muted")} style={{margin:"0 auto 14px",animation:"pkSpin .9s linear infinite"}}/>
                <p style={{fontSize:13,fontWeight:600,color:C.txt("sec")}}>{t("packing.loadingBoxData", "Loading box data...")}</p>
                <p style={{fontSize:11,color:C.txt("muted"),marginTop:4}}>⏳ Please wait</p>
              </div>
            ):!displaySess?(
              <div style={{padding:"64px 24px",textAlign:"center"}}>
                <Boxes size={36} color={C.txt("muted")} style={{margin:"0 auto 16px",opacity:0.3}}/>
                <p style={{fontSize:14,fontWeight:700,color:C.txt("sec"),marginBottom:6}}>{t("packing.noBoxSelected", "No box selected")}</p>
                <p style={{fontSize:12,color:C.txt("muted")}}>{t("packing.selectBoxOrScan", "Select a box from the dropdown or scan a QR code.")}</p>
              </div>
            ):view==="grid"?(
              <div style={{padding:20}}>
                <div style={{
                  display:"grid",
                  gridTemplateColumns:`repeat(auto-fill,minmax(${boxSize}px,1fr))`,
                  gap:8,
                }} className="pk-box-grid">
                  {Array.from({length:capacity},(_,i)=>{
                    const slotId=i+1;
                    const item=filledMap.get(slotId);
                    const isHov=hoveredSlot===slotId;
                    const isFilled = !!item;
                    return(
                      <div key={slotId}
                        onMouseEnter={(event)=>handleSlotMouseEnter(slotId,event)}
                        onMouseMove={updateTooltipPosition}
                        onMouseLeave={()=>setHoveredSlot(null)}
                        style={{
                          position:"relative",
                          height:boxSize,
                          borderRadius:10,
                          border:`1.5px solid ${isFilled ? C.ok(0.5) : C.bdr(0.18)}`,
                          background:isFilled
                            ? `linear-gradient(135deg, ${C.ok(0.15)}, ${C.ok(0.05)})`
                            : C.bg("slot"),
                          display:"flex",
                          flexDirection:"column",
                          alignItems:"center",
                          justifyContent:"center",
                          gap:2,
                          cursor:"default",
                          transition:"all .15s ease",
                          transform:isHov?"scale(1.06)":"scale(1)",
                          zIndex:isHov?10:1,
                          boxShadow:isFilled
                            ? isHov ? `0 4px 16px ${C.ok(0.2)}` : 'none'
                            : isHov ? `0 4px 16px ${C.bdr(0.15)}` : 'none',
                        }}>
                        <span style={{
                          fontSize:capacity>80?10:12,
                          fontWeight:800,
                          color:isFilled?C.ok():C.txt("muted"),
                          fontFamily:"'DM Mono',monospace",
                        }}>
                          {slotId}
                        </span>
                        {isFilled ? (
                          <div style={{
                            width:8,
                            height:8,
                            borderRadius:"50%",
                            background:C.ok(),
                            boxShadow:`0 0 12px ${C.ok(0.6)}`,
                            animation:"pkPulse 2s ease-in-out infinite",
                          }}/>
                        ) : (
                          <span style={{
                            fontSize:7,
                            color:C.txt("muted"),
                            textTransform:"uppercase",
                            fontWeight:600,
                            opacity:0.6,
                          }}>{t("packing.empty", "Empty")}</span>
                        )}
                        {isFilled && (
                          <div style={{
                            position:"absolute",
                            top:-2,
                            right:-2,
                            width:10,
                            height:10,
                            borderRadius:"50%",
                            background:C.ok(),
                            border:`2px solid ${C.bg("card")}`,
                            display:"flex",
                            alignItems:"center",
                            justifyContent:"center",
                            fontSize:6,
                            color:"#fff",
                            fontWeight:900,
                          }}>✓</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{
                  display:"flex",
                  alignItems:"center",
                  gap:16,
                  marginTop:16,
                  padding:"10px 0 4px 0",
                  borderTop:`1px solid ${C.bdr(0.1)}`,
                  fontSize:10,
                  color:C.txt("muted"),
                  flexWrap:"wrap",
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{
                      width:14,
                      height:14,
                      borderRadius:4,
                      background:`linear-gradient(135deg,${C.ok(0.2)},${C.ok(0.08)})`,
                      border:`1.5px solid ${C.ok(0.45)}`,
                    }}/>
                    <span>✅ {t("packing.packed", "Packed")}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{
                      width:14,
                      height:14,
                      borderRadius:4,
                      background:C.bg("slot"),
                      border:`1.5px solid ${C.bdr(0.18)}`,
                    }}/>
                    <span>⬜ {t("packing.empty", "Empty")}</span>
                  </div>
                  <span style={{marginLeft:"auto",fontStyle:"italic",display:"flex",alignItems:"center",gap:4}}>
                    🔍 {t("packing.hoverForDetails", "Hover for details")}
                  </span>
                </div>
              </div>
            ):(
              <div style={{overflowX:"auto",padding:"4px 0"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{
                      background:`linear-gradient(90deg,${C.navy(0.06)},${C.steel(0.04)})`,
                      borderBottom:`1px solid ${C.bdr()}`,
                    }}>
                      {[
                        "#",t("packing.slot", "Slot"),t("packing.partId", "Part ID"),
                        t("packing.customerQrCode", "Customer QR"),t("packing.station", "Station"),
                        t("packing.machine", "Machine"),t("packing.packedAt", "Packed At")
                      ].map(h=>(
                        <th key={h} style={{
                          padding:"10px 14px",
                          textAlign:"left",
                          fontSize:9,
                          fontWeight:800,
                          textTransform:"uppercase",
                          letterSpacing:"0.08em",
                          color:C.txt("muted"),
                          whiteSpace:"nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayItems.length===0?(
                      <tr><td colSpan={7} style={{padding:"40px",textAlign:"center",color:C.txt("muted")}}>
                        📭 {t("packing.noPartsYet", "No parts yet")}
                      </td></tr>
                    ):displayItems.map((item,i)=>(
                      <tr key={i} style={{
                        borderBottom:`1px solid ${C.bdr(0.06)}`,
                        background:i%2===1?C.bg("surf"):"transparent",
                        transition:"background .1s ease",
                      }}>
                        <td style={{padding:"10px 14px",color:C.txt("muted"),fontSize:11}}>{i+1}</td>
                        <td style={{
                          padding:"10px 14px",
                          fontFamily:"'DM Mono',monospace",
                          fontWeight:700,
                          color:C.steel(),
                        }}>{item.slotNo||"—"}</td>
                        <td style={{
                          padding:"10px 14px",
                          fontFamily:"'DM Mono',monospace",
                          fontSize:11,
                          fontWeight:600,
                          color:C.txt("pri"),
                        }}>{item.partId||"—"}</td>
                        <td style={{
                          padding:"10px 14px",
                          fontFamily:"'DM Mono',monospace",
                          fontSize:10,
                          color:C.txt("sec"),
                        }}>{item.customerQrCode||"-"}</td>
                        <td style={{padding:"10px 14px",fontSize:11,color:C.txt("sec")}}>
                          {item.stationNo||item.operationNo||item.currentStation||"-"}
                        </td>
                        <td style={{padding:"10px 14px",fontSize:10,color:C.txt("pri")}}>
                          {item.machineName||"-"}
                        </td>
                        <td style={{
                          padding:"10px 14px",
                          fontSize:10,
                          color:C.txt("muted"),
                          fontFamily:"'DM Mono',monospace",
                        }}>{fmtTime(item.packedAt||item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ── Right Sidebar ──────────────────────────────────────── */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {/* Status Card */}
          <Card
            title="📋 Session Overview"
            subtitle="📊 Packing Metrics"
            icon={Clock}
            accent={C.amber()}
          >
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{
                display:"flex",
                justifyContent:"space-between",
                alignItems:"center",
                paddingBottom:10,
                borderBottom:`1px solid ${C.bdr(0.08)}`,
              }}>
                <span style={{fontSize:11,color:C.txt("muted"),display:"flex",alignItems:"center",gap:5}}>
                  <Package size={13}/> {t("packing.boxNumber", "Box Number")}
                </span>
                <span style={{
                  fontSize:13,
                  fontFamily:"'DM Mono',monospace",
                  fontWeight:700,
                  color:C.amber(),
                  letterSpacing:"0.02em",
                }}>
                  {displaySess?.boxNumber||"—"}
                </span>
              </div>
              <div style={{
                display:"flex",
                justifyContent:"space-between",
                alignItems:"center",
                paddingBottom:10,
                borderBottom:`1px solid ${C.bdr(0.08)}`,
              }}>
                <span style={{fontSize:11,color:C.txt("muted"),display:"flex",alignItems:"center",gap:5}}>
                  <Activity size={13}/> {t("packing.status", "Status")}
                </span>
                <Badge
                  v={displaySess?.status==="CLOSED"?"ok":"wip"}
                  l={translateSessionStatus(displaySess?.status)}
                  pulse={!!activeSession}
                  size="sm"
                />
              </div>
              <div style={{
                display:"flex",
                justifyContent:"space-between",
                alignItems:"center",
                paddingBottom:10,
                borderBottom:`1px solid ${C.bdr(0.08)}`,
              }}>
                <span style={{fontSize:11,color:C.txt("muted"),display:"flex",alignItems:"center",gap:5}}>
                  <TrendingUp size={13}/> {t("packing.packingRate", "Packing Rate")}
                </span>
                <span style={{
                  fontSize:13,
                  fontWeight:700,
                  color:C.ok(),
                  fontFamily:"'DM Mono',monospace",
                }}>{eff} pcs/min</span>
              </div>
              <div style={{
                display:"flex",
                justifyContent:"space-between",
                alignItems:"center",
              }}>
                <span style={{fontSize:11,color:C.txt("muted"),display:"flex",alignItems:"center",gap:5}}>
                  <Clock size={13}/> {t("packing.created", "Created")}
                </span>
                <span style={{
                  fontSize:10,
                  fontFamily:"'DM Mono',monospace",
                  color:C.txt("sec"),
                }}>{fmtDT(displaySess?.createdAt)}</span>
              </div>
              {displaySess?.createdAt && (
                <div style={{
                  marginTop:4,
                  padding:"8px 12px",
                  borderRadius:8,
                  background:C.bg("surf"),
                  border:`1px solid ${C.bdr(0.08)}`,
                  display:"flex",
                  justifyContent:"space-between",
                  alignItems:"center",
                }}>
                  <span style={{fontSize:10,color:C.txt("muted")}}>⏱️ Duration</span>
                  <span style={{
                    fontSize:11,
                    fontWeight:600,
                    color:C.txt("pri"),
                    fontFamily:"'DM Mono',monospace",
                  }}>{fmtDuration(displaySess?.createdAt)}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Stats Card */}
          <Card
            title="📈 Quick Stats"
            subtitle="📊 Performance"
            icon={Award}
            accent={C.gold()}
          >
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}} className="pk-stats-grid">
              <div style={{
                background:C.bg("surf"),
                borderRadius:10,
                padding:"12px 14px",
                border:`1px solid ${C.bdr(0.06)}`,
              }}>
                <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:C.txt("muted")}}>
                  📦 Total Items
                </p>
                <p style={{fontSize:18,fontWeight:900,color:C.txt("pri"),fontFamily:"'DM Mono',monospace"}}>
                  {displayItems.length}
                </p>
              </div>
              <div style={{
                background:C.bg("surf"),
                borderRadius:10,
                padding:"12px 14px",
                border:`1px solid ${C.bdr(0.06)}`,
              }}>
                <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:C.txt("muted")}}>
                  ⚡ Packing Rate
                </p>
                <p style={{fontSize:18,fontWeight:900,color:C.ok(),fontFamily:"'DM Mono',monospace"}}>
                  {eff} <span style={{fontSize:11,fontWeight:600,color:C.txt("muted")}}>pcs/min</span>
                </p>
              </div>
              <div style={{
                background:C.bg("surf"),
                borderRadius:10,
                padding:"12px 14px",
                border:`1px solid ${C.bdr(0.06)}`,
              }}>
                <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:C.txt("muted")}}>
                  📊 Capacity
                </p>
                <p style={{fontSize:18,fontWeight:900,color:C.steel(),fontFamily:"'DM Mono',monospace"}}>
                  {capacity}
                </p>
              </div>
              <div style={{
                background:C.bg("surf"),
                borderRadius:10,
                padding:"12px 14px",
                border:`1px solid ${C.bdr(0.06)}`,
              }}>
                <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:C.txt("muted")}}>
                  🔲 Fill Rate
                </p>
                <p style={{
                  fontSize:18,
                  fontWeight:900,
                  color:fillColor,
                  fontFamily:"'DM Mono',monospace",
                }}>{progressPct}%</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ══ PACKED PARTS TABLE ═══════════════════════════════════════ */}
      <Card
        noPad
        title={`${displayItems.length} ${t("packing.packedParts", "Packed Parts")}`}
        subtitle={`${filledCount} ${t("packing.of", "of")} ${capacity} ${t("packing.slotsFilled", "slots filled")}`}
        icon={ClipboardCheck}
        accent={C.ok()}
        right={
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{
              display:"flex",
              alignItems:"center",
              gap:6,
              padding:"4px 12px",
              borderRadius:99,
              background:C.ok(0.08),
              border:`1px solid ${C.ok(0.2)}`,
            }}>
              <div style={{
                width:6,
                height:6,
                borderRadius:"50%",
                background:C.ok(),
                animation:activeSession?"pkPulse 1.2s ease-in-out infinite":"none",
              }}/>
              <span style={{fontSize:10,fontWeight:700,color:C.ok()}}>
                {activeSession ? t("packing.live", "● LIVE") : t("packing.history", "📜 History")}
              </span>
            </div>
          </div>
        }
      >
        {displayItems.length===0?(
          <div style={{padding:"64px 24px",textAlign:"center"}}>
            <Package size={32} color={C.txt("muted")} style={{margin:"0 auto 16px",opacity:0.2}}/>
            <p style={{fontSize:14,fontWeight:700,color:C.txt("sec"),marginBottom:6}}>
              {t("packing.noPartsPacked", "No parts packed yet")}
            </p>
            <p style={{fontSize:12,color:C.txt("muted")}}>🔍 Start scanning items to pack them into this box</p>
          </div>
        ):(
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{
                  background:`linear-gradient(135deg,${C.navy(0.9)},${C.steel(0.8)})`,
                }}>
                  {["#",t("packing.slot", "Slot"),t("packing.partId", "Part ID"),t("packing.customerQrCode", "Customer QR"),t("packing.station", "Station"),t("packing.machine", "Machine"),t("packing.packingTime", "⏱️ Packing Time")].map(h=>(
                    <th key={h} style={{
                      padding:"10px 14px",
                      textAlign:"left",
                      fontSize:8,
                      fontWeight:800,
                      textTransform:"uppercase",
                      letterSpacing:"0.1em",
                      color:C.linen(0.9),
                      whiteSpace:"nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item,i)=>{
                  const isSame = String(item.partId).trim() === String(item.customerQrCode).trim();
                  const dPartId = (!isSame && item.customerQrCode) ? item.partId : "";
                  const dCustQr = item.customerQrCode || item.partId;
                  return (
                    <tr key={i} style={{
                      borderBottom:`1px solid ${C.bdr(0.06)}`,
                      background:i%2===1?C.bg("surf"):"transparent",
                      transition:"background .1s ease",
                    }}>
                      <td style={{padding:"10px 14px",color:C.txt("muted"),fontSize:11,fontWeight:600}}>{i+1}</td>
                      <td style={{padding:"8px 14px"}}>
                        <div style={{
                          display:"inline-flex",
                          alignItems:"center",
                          justifyContent:"center",
                          width:28,
                          height:28,
                          borderRadius:6,
                          background:C.ok(0.1),
                          border:`1px solid ${C.ok(0.3)}`,
                          fontSize:12,
                          fontWeight:700,
                          color:C.ok(),
                        }}>
                          {item.slotNo||"—"}
                        </div>
                      </td>
                      <td style={{
                        padding:"10px 14px",
                        fontSize:13,
                        fontWeight:600,
                        color:C.txt("pri"),
                        fontFamily:"'DM Mono',monospace",
                      }}>
                        {dPartId}
                      </td>
                      <td style={{
                        padding:"10px 14px",
                        fontSize:12,
                        fontWeight:500,
                        color:C.txt("sec"),
                        fontFamily:"'DM Mono',monospace",
                      }}>
                        {dCustQr}
                      </td>
                      <td style={{padding:"10px 14px",fontSize:12,color:C.txt("sec")}}>
                        {item.stationNo||item.operationNo||item.currentStation||"-"}
                      </td>
                      <td style={{padding:"10px 14px",fontSize:12,color:C.txt("pri")}}>
                        {item.machineName||"-"}
                      </td>
                      <td style={{
                        padding:"10px 14px",
                        fontSize:11,
                        color:C.txt("muted"),
                        whiteSpace:"nowrap",
                        fontFamily:"'DM Mono',monospace",
                      }}>
                        {fmtTime(item.packedAt||item.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ══ FLOATING TOOLTIP ════════════════════════════════════════ */}
      {tooltipItem && tooltipSlot && (() => {
        const isSame = String(tooltipItem.partId).trim() === String(tooltipItem.customerQrCode).trim();
        const dPartId = (!isSame && tooltipItem.customerQrCode) ? tooltipItem.partId : "";
        const dCustQr = tooltipItem.customerQrCode || tooltipItem.partId;
        return (
          <div style={{
            position:"fixed",
            left: tooltipPos.x + 16,
            top: tooltipPos.y - 10,
            zIndex:9999,
            pointerEvents:"none",
            transform: tooltipFlips ? "translateX(calc(-100% - 32px))" : "none",
            animation:"pkFadeIn .12s ease",
          }}>
            <div style={{
              background:C.bg("card"),
              border:`1.5px solid ${C.ok(0.4)}`,
              borderRadius:14,
              boxShadow:`0 12px 48px rgba(0,0,0,0.3),0 4px 16px rgba(0,0,0,0.15),0 0 0 1px ${C.ok(0.1)}`,
              overflow:"hidden",
              minWidth:280,
              maxWidth:340,
            }}>
              {/* Header */}
              <div style={{
                background:`linear-gradient(135deg,${C.ok(0.15)},${C.ok(0.05)})`,
                borderBottom:`1px solid ${C.ok(0.15)}`,
                padding:"10px 16px",
                display:"flex",
                alignItems:"center",
                gap:10,
              }}>
                <div style={{
                  width:24,
                  height:24,
                  borderRadius:6,
                  background:C.ok(0.15),
                  border:`1px solid ${C.ok(0.3)}`,
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                }}>
                  <span style={{fontSize:11,fontWeight:900,color:C.ok()}}>✓</span>
                </div>
                <div>
                  <span style={{
                    fontSize:8,
                    fontWeight:800,
                    textTransform:"uppercase",
                    letterSpacing:"0.08em",
                    color:C.ok(),
                  }}>Slot {tooltipSlot} · Packed</span>
                </div>
              </div>
              {/* Body */}
              <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                <div>
                  <p style={{
                    fontSize:7,
                    fontWeight:800,
                    textTransform:"uppercase",
                    letterSpacing:"0.08em",
                    color:C.txt("muted"),
                    marginBottom:4,
                  }}>🔹 Part Serial No.</p>
                  <p style={{
                    fontSize:13,
                    fontWeight:700,
                    color:C.txt("pri"),
                    wordBreak:"break-all",
                    fontFamily:"'DM Mono',monospace",
                  }}>{dPartId || "—"}</p>
                </div>
                <div style={{borderTop:`1px solid ${C.bdr(0.08)}`,paddingTop:10}}>
                  <p style={{
                    fontSize:7,
                    fontWeight:800,
                    textTransform:"uppercase",
                    letterSpacing:"0.08em",
                    color:C.txt("muted"),
                    marginBottom:4,
                  }}>🔲 Customer QR Code</p>
                  <p style={{
                    fontSize:13,
                    fontWeight:600,
                    color:C.steel(),
                    wordBreak:"break-all",
                    fontFamily:"'DM Mono',monospace",
                  }}>{dCustQr}</p>
                </div>
                <div style={{
                  borderTop:`1px solid ${C.bdr(0.06)}`,
                  paddingTop:8,
                  display:"flex",
                  justifyContent:"space-between",
                  alignItems:"center",
                }}>
                  <span style={{fontSize:9,color:C.txt("muted")}}>⏱️ Packed at</span>
                  <span style={{
                    fontSize:10,
                    fontWeight:600,
                    color:C.txt("sec"),
                    fontFamily:"'DM Mono',monospace",
                  }}>{fmtDT(tooltipItem.packedAt||tooltipItem.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Packing;
