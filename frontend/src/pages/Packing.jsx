// ============================================================
//  Packing.jsx — IndusTrace Premium Packing Station
//  ✓ Auto-generated QR code (square, scannable) per box
//  ✓ Scan QR → show box ID, packed count, parts list
//  ✓ Professional Navy/Steel/Amber/Linen theme
//  ✓ Box grid visualization with smaller boxes
//  ✓ Clickable QR icon in header opens modal
//  ✓ Fully responsive design (mobile/tablet/desktop)
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL } from "../constants/network";
import {
  Boxes, Printer, RefreshCw, ScanLine, CheckCircle2,
  Clock, Package, QrCode, X, AlertCircle,
  LayoutGrid, List, Zap, Radio, Eye,
} from "lucide-react";
import { packingApi } from "../api/services";



// ── Design tokens ──────────────────────────────────────────────────────────
const DS = `
  @keyframes pkSpin   { to{transform:rotate(360deg)} }
  @keyframes pkFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pkPulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
  @keyframes pkPing   { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.2);opacity:0} }
  @keyframes pkSlot   { from{opacity:0;transform:scale(.7)} to{opacity:1;transform:scale(1)} }
  @keyframes pkGlow   { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4)} 50%{box-shadow:0 0 12px 3px rgba(34,197,94,.25)} }
  :root{
    --pk-navy:  26,50,99;   --pk-steel: 84,119,146;
    --pk-amber: 250,185,91; --pk-linen: 232,226,219;
    --pk-ok:    34,197,94;  --pk-ng:    239,68,68;
    --pk-wip:   249,115,22; --pk-idle:  148,163,184;
  }
  [data-theme="light"]{
    --pk-bg-card:255,255,255; --pk-bg-surf:240,236,230;
    --pk-bg-input:255,255,255; --pk-bg-slot:248,246,243;
    --pk-txt-pri:26,50,99; --pk-txt-sec:84,119,146;
    --pk-txt-muted:140,160,180;
    --pk-bdr:84,119,146; --pk-bop:0.13;
  }
  [data-theme="dark"]{
    --pk-bg-card:20,34,62; --pk-bg-surf:16,26,50;
    --pk-bg-input:14,22,44; --pk-bg-slot:12,20,42;
    --pk-txt-pri:232,226,219; --pk-txt-sec:120,160,190;
    --pk-txt-muted:84,119,146;
    --pk-bdr:84,119,146; --pk-bop:0.18;
  }
  @media (max-width: 768px) {
    .pk-header-main { flex-direction: column !important; align-items: stretch !important; }
    .pk-header-actions { justify-content: space-between !important; flex-wrap: wrap !important; }
    .pk-box-grid { grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)) !important; gap: 6px !important; }
    .pk-main-layout { grid-template-columns: 1fr !important; }
    .pk-progress-strip { flex-direction: column !important; align-items: stretch !important; }
    .pk-box-selector { width: 100%; justify-content: space-between !important; }
  }
  @media (max-width: 480px) {
    .pk-box-grid { grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)) !important; gap: 4px !important; }
    .pk-header-title h1 { font-size: 14px !important; }
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
  bg:   (v="card") =>`rgb(var(--pk-bg-${v}))`,
  txt:  (v="pri")  =>`rgb(var(--pk-txt-${v}))`,
  bdr:  (o)        =>`rgba(var(--pk-bdr),${o||"var(--pk-bop)"})`,
};
const SH =`0 2px 12px rgba(var(--pk-navy),.09),0 1px 4px rgba(var(--pk-navy),.06)`;
const SHM=`0 8px 28px rgba(var(--pk-navy),.18),0 2px 8px rgba(var(--pk-navy),.1)`;

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(v){if(!v)return"—";const d=new Date(v);return isNaN(d)?"—":d.toLocaleTimeString();}
function fmtDT(v){if(!v)return"—";const d=new Date(v);return isNaN(d)?"—":d.toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});}

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

// ── QR Code Generator — pure JS matrix ────────────────────────────────────
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

  for(let i=8;i<size-8;i++){
    mat[6][i]=i%2===0?1:0;
    mat[i][6]=i%2===0?1:0;
  }

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
function printBoxLabel(session,items){
  if(!session)return;
  const labelCode=session.labelCode||session.boxNumber;

  const mat=generateQRMatrix(labelCode);
  const n=mat.length,cell=4,pad=4,qSize=n*cell+pad*2;
  const qRects=mat.map((row,r)=>row.map((v,c)=>v?`<rect x="${pad+c*cell}" y="${pad+r*cell}" width="${cell}" height="${cell}" fill="#000"/>`:"").join("")).join("");
  const qSvg=`<svg width="${qSize}" height="${qSize}" viewBox="0 0 ${qSize} ${qSize}" xmlns="http://www.w3.org/2000/svg" style="shape-rendering:crispEdges"><rect width="${qSize}" height="${qSize}" fill="#fff"/>${qRects}</svg>`;

  const partsRows=(items||[]).map((item,i)=>`
    <tr>
      <td style="color:#94a3b8;font-size:9px">${i+1}</td>
      <td style="font-family:monospace;font-weight:700;color:#547792">${item.slotNo||"—"}</td>
      <td style="font-family:monospace;font-weight:700;color:#1a3263">${item.partId||"—"}</td>
      <td style="color:#374151">${item.operationNo||"—"}</td>
      <td style="color:#22C55E;font-weight:700">✓ Pass</td>
      <td style="font-family:monospace;font-size:9px;color:#6b7280">${item.packedAt?new Date(item.packedAt).toLocaleString():"—"}</td>
    </tr>`).join("");

  const html=`<!DOCTYPE html><html><head>
<meta charset="UTF-8"/><title>Packing Label — ${session.boxNumber}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#0f172a;font-size:11px}
.page{max-width:920px;margin:0 auto;padding:20px 26px}
.hdr{background:linear-gradient(135deg,#1a3263,#547792);color:#fff;padding:18px 24px;border-radius:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center}
.hdr h1{font-size:18px;font-weight:900;margin-bottom:3px}
.certified{background:rgba(250,185,91,.2);border:1px solid rgba(250,185,91,.5);color:#FAB95B;padding:4px 12px;border-radius:99px;font-size:9px;font-weight:800}
.label-area{display:flex;gap:18px;margin-bottom:16px}
.qr-col{background:#fff;border:2px solid #1a3263;border-radius:12px;padding:14px 12px;display:flex;flex-direction:column;align-items:center;gap:8px}
.meta-col{flex:1}
.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
.meta-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:9px 11px}
.lbl{font-size:7px;font-weight:800;text-transform:uppercase;color:#94a3b8;margin-bottom:3px}
.val{font-size:15px;font-weight:900;font-family:monospace;color:#1a3263}
table{width:100%;border-collapse:collapse}
thead tr{background:#1a3263;color:#fff}
thead th{padding:7px 10px;text-align:left;font-size:7px;font-weight:700}
tbody td{padding:6px 10px;border-bottom:1px solid #f1f5f9}
.footer{margin-top:16px;padding-top:9px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:7px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><div class="page">
<div class="hdr"><div><h1>📦 Certified Packing List</h1><p>IndusTrace MES — Final Goods Registry</p></div><div class="certified">✓ QUALITY CERTIFIED</div></div>
<div class="label-area"><div class="qr-col">${qSvg}<div style="font-family:monospace;font-size:10px;font-weight:900">${labelCode}</div></div>
<div class="meta-col"><div class="meta-grid">
<div class="meta-item"><div class="lbl">Box ID</div><div class="val">${session.boxNumber}</div></div>
<div class="meta-item"><div class="lbl">Packed</div><div class="val" style="color:#22C55E">${items.length} / ${session.capacity}</div></div>
<div class="meta-item"><div class="lbl">Status</div><div class="val" style="color:#22C55E">${session.status||"OPEN"}</div></div>
</div></div></div>
<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Slot</th><th>Part Serial</th><th>Operation</th><th>QC</th><th>Packed At</th></tr></thead><tbody>${partsRows}</tbody></table></div>
<div class="footer"><span>IndusTrace MES — Box: ${session.boxNumber}</span><span>Printed: ${new Date().toLocaleString()}</span></div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},700);}</script>
</body></html>`;

  const w=window.open("","_blank","width=1020,height=780");
  if(!w){alert("Allow popups to print label.");return;}
  w.document.write(html);w.document.close();
}

// ── Atoms ──────────────────────────────────────────────────────────────────
const Card=({title,subtitle,icon:Icon,accent,right,children,noPad})=>(
  <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
    borderRadius:14,overflow:"hidden",boxShadow:SH,
    borderTop:accent?`3px solid ${accent}`:"none"}}>
    {(title||right)&&(
      <div style={{padding:"12px 17px",borderBottom:`1px solid ${C.bdr()}`,
        background:C.bg("surf"),display:"flex",alignItems:"center",
        justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {Icon&&<div style={{width:28,height:28,borderRadius:7,background:C.navy(0.1),
            border:`1px solid ${C.navy(0.18)}`,display:"flex",alignItems:"center",
            justifyContent:"center"}}><Icon size={13} color={C.steel()}/></div>}
          <div>
            {subtitle&&<p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
              letterSpacing:"0.09em",color:C.txt("muted"),marginBottom:1}}>{subtitle}</p>}
            <p style={{fontSize:13,fontWeight:700,color:C.txt("pri")}}>{title}</p>
          </div>
        </div>
        {right}
      </div>
    )}
    <div style={noPad?{}:{padding:16}}>{children}</div>
  </div>
);

const Badge=({v="idle",l,pulse})=>{
  const m={ok:{fg:C.ok(),bg:C.ok(0.1),bd:C.ok(0.25)},ng:{fg:C.ng(),bg:C.ng(0.1),bd:C.ng(0.25)},
    wip:{fg:C.wip(),bg:C.wip(0.1),bd:C.wip(0.25)},idle:{fg:C.idle(),bg:C.idle(0.08),bd:C.idle(0.2)},
    amber:{fg:C.amber(),bg:C.amber(0.12),bd:C.amber(0.3)}};
  const s=m[v]||m.idle;
  return<span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",
    borderRadius:99,fontSize:11,fontWeight:700,color:s.fg,background:s.bg,border:`1px solid ${s.bd}`,
    whiteSpace:"nowrap"}}>
    <span style={{width:5,height:5,borderRadius:"50%",background:s.fg,flexShrink:0,
      animation:pulse?"pkPulse 1.2s ease-in-out infinite":"none"}}/>{l}</span>;
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

// ══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
const Packing=()=>{
  injectDS();

  const[overview,    setOverview]    =useState({activeSession:null,activeItems:[],recentSessions:[],finalPackingStations:[],managementSettings:null});
  const[selectedBox, setSelectedBox]  =useState("");
  const[selectedSess,setSelectedSess]=useState(null);
  const[popup,       setPopup]       =useState(null);
  const[loadingOv,   setLoadingOv]   =useState(true);
  const[loadingSess, setLoadingSess] =useState(false);
  const[hoveredSlot, setHoveredSlot] =useState(null);
  const[view,        setView]        =useState("grid");
  const[scanFlash,   setScanFlash]   =useState(false);
  const[scanResult,  setScanResult]  =useState(null);
  const[showQRModal, setShowQRModal] =useState(false);
  const selectedBoxRef=useRef("");

  const activeSession=overview.activeSession;
  const activeItems  =useMemo(()=>overview.activeItems||[],[overview.activeItems]);
  const selectedItems=useMemo(()=>selectedSess?.items||[],[selectedSess?.items]);

  const displaySess=selectedSess||activeSession;
  const displayItems=useMemo(()=>{
    if(!displaySess)return[];
    if(activeSession&&Number(displaySess.id)===Number(activeSession.id))
      return activeItems.map(i=>({...i,qrCode:i.partId,packedAt:i.packedAt||i.createdAt}));
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

  useScanInput(useCallback((scanned)=>{
    setScanFlash(true);setTimeout(()=>setScanFlash(false),800);
    const boxes=[activeSession?.boxNumber,...(overview.recentSessions||[]).map(s=>s.boxNumber)].filter(Boolean);
    const matched=boxes.find(b=>scanned.includes(b)||b.includes(scanned)||scanned===b);
    const boxNum=matched||scanned;
    setSelectedBox(boxNum);selectedBoxRef.current=boxNum;
    loadSession(boxNum).then(()=>{
      setScanResult({boxNumber:boxNum,scannedAt:new Date().toISOString()});
    });
  },[activeSession,overview.recentSessions,loadSession]));

  useEffect(()=>{
    const socket=io(SOCKET_URL,{
      path:"/socket.io/",
      transports: ["polling"], upgrade: false,
      reconnection:true,
      reconnectionAttempts:Infinity,
      reconnectionDelay:1000,
      reconnectionDelayMax:5000,
      timeout:10000,
    });
    socket.on("packing_update",(payload={})=>{
      loadOverview(payload.boxNumber).catch(()=>{});
    });
    return()=>{
      socket.off("packing_update");
      if (socket.connected) socket.disconnect();
    };
  },[loadOverview]);

  const handleSelectBox=(e)=>{
    const v=e.target.value.toUpperCase();
    setSelectedBox(v);selectedBoxRef.current=v;loadSession(v);
  };

  const handlePrint=()=>{printBoxLabel(displaySess,displayItems);};

  // Packing rate: parts packed per minute since session start
  const eff = displaySess?.createdAt
    ? (displayItems.length / Math.max(1, (Date.now() - new Date(displaySess.createdAt).getTime()) / 60000)).toFixed(1)
    : "—";

  // Calculate responsive box size based on capacity and screen width
  const getBoxSize = () => {
    if (typeof window !== 'undefined') {
      const width = window.innerWidth;
      if (width <= 480) return capacity > 100 ? 36 : 42;
      if (width <= 768) return capacity > 100 ? 44 : 52;
    }
    if (capacity <= 36) return 72;
    if (capacity <= 64) return 58;
    if (capacity <= 100) return 48;
    return 42;
  };
  const [boxSize, setBoxSize] = useState(getBoxSize());
  useEffect(() => {
    const handleResize = () => setBoxSize(getBoxSize());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [capacity]);

  return(
    <div style={{display:"flex",flexDirection:"column",gap:18,paddingBottom:32,
      animation:"pkFadeIn .3s ease",outline:scanFlash?`3px solid ${C.ok()}`:"none",
      transition:"outline .1s",borderRadius:4}}>


      {/* ── QR Scan Result Modal ─────────────────────────────────── */}
      {scanResult&&(
        <div style={{position:"fixed",inset:0,zIndex:1200,display:"flex",
          alignItems:"center",justifyContent:"center",padding:16,
          background:"rgba(0,0,0,0.72)",backdropFilter:"blur(6px)"}}>
          <div style={{width:"100%",maxWidth:460,background:C.bg("card"),
            border:`1px solid ${C.bdr()}`,borderRadius:18,overflow:"hidden",
            boxShadow:SHM,animation:"pkFadeIn .2s ease"}}>
            <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>
            <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.bdr()}`,
              background:C.bg("surf"),display:"flex",alignItems:"center",
              justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:8,background:C.ok(0.12),
                  border:`1px solid ${C.ok(0.3)}`,display:"flex",alignItems:"center",
                  justifyContent:"center"}}>
                  <QrCode size={15} color={C.ok()}/>
                </div>
                <div>
                  <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                    letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:1}}>QR Scan Result</p>
                  <p style={{fontSize:13,fontWeight:700,color:C.ok()}}>Box Found</p>
                </div>
              </div>
              <button onClick={()=>setScanResult(null)} style={{width:28,height:28,
                borderRadius:6,background:"none",border:`1px solid ${C.bdr()}`,
                cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                color:C.txt("muted")}}>
                <X size={13}/>
              </button>
            </div>
            <div style={{padding:"18px 20px 22px"}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
                {[
                  {label:"Box ID", value:displaySess?.boxNumber||scanResult.boxNumber,mono:true},
                  {label:"Packed / Total",value:`${filledCount} / ${capacity}`,mono:true},
                  {label:"Status", value:displaySess?.status||"OPEN",mono:false},
                ].map((f,i)=>(
                  <div key={i} style={{background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                    borderRadius:9,padding:"9px 11px"}}>
                    <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                      letterSpacing:"0.08em",color:C.txt("muted"),marginBottom:4}}>{f.label}</p>
                    <p style={{fontSize:12,fontWeight:700,color:C.txt("pri"),
                      fontFamily:f.mono?"'DM Mono',monospace":"inherit"}}>{f.value}</p>
                  </div>
                ))}
              </div>
              <div style={{marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.txt("muted"),marginBottom:5}}>
                  <span>Fill level</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:fillColor}}>{progressPct}%</span>
                </div>
                <div style={{height:8,borderRadius:99,background:C.bdr(0.15),overflow:"hidden"}}>
                  <div style={{height:"100%",background:fillColor,width:`${progressPct}%`,transition:"width .5s",borderRadius:99}}/>
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setScanResult(null)}
                  style={{flex:1,height:38,borderRadius:9,fontSize:12,fontWeight:700,
                    cursor:"pointer",background:"transparent",border:`1px solid ${C.bdr()}`,color:C.txt("sec")}}>Close</button>
                <button onClick={()=>{setScanResult(null);handlePrint();}}
                  style={{flex:2,height:38,borderRadius:9,fontSize:12,fontWeight:800,
                    cursor:"pointer",background:C.amber(),border:"none",color:C.navy(),
                    display:"flex",alignItems:"center",justifyContent:"center",gap:6,
                    boxShadow:`0 3px 12px ${C.amber(0.3)}`}}>
                  <Printer size={14}/> Print Label
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal (click from header) ────────────────────── */}
      {showQRModal && displaySess && (
        <div style={{position:"fixed",inset:0,zIndex:1200,display:"flex",
          alignItems:"center",justifyContent:"center",padding:16,
          background:"rgba(0,0,0,0.72)",backdropFilter:"blur(6px)"}}>
          <div style={{width:"100%",maxWidth:420,background:C.bg("card"),
            border:`1px solid ${C.bdr()}`,borderRadius:20,overflow:"hidden",
            boxShadow:SHM,animation:"pkFadeIn .2s ease"}}>
            <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>
            <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.bdr()}`,
              background:C.bg("surf"),display:"flex",alignItems:"center",
              justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:8,background:C.amber(0.12),
                  border:`1px solid ${C.amber(0.3)}`,display:"flex",alignItems:"center",
                  justifyContent:"center"}}>
                  <QrCode size={15} color={C.amber()}/>
                </div>
                <div>
                  <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                    letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:1}}>Box QR Code</p>
                  <p style={{fontSize:13,fontWeight:700,color:C.amber()}}>Scan to Verify</p>
                </div>
              </div>
              <button onClick={()=>setShowQRModal(false)} style={{width:28,height:28,
                borderRadius:6,background:"none",border:`1px solid ${C.bdr()}`,
                cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                color:C.txt("muted")}}>
                <X size={13}/>
              </button>
            </div>
            <div style={{padding:"28px 20px",textAlign:"center"}}>
              <div style={{background:"#ffffff",borderRadius:16,padding:20,
                display:"inline-block",boxShadow:`0 8px 28px rgba(0,0,0,0.15)`,
                marginBottom:16}}>
                <QRCodeSVG
                  value={displaySess.labelCode||displaySess.boxNumber}
                  size={220}
                  fgColor="#1a3263"
                  bgColor="#ffffff"
                />
              </div>
              <p style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:800,
                color:C.txt("pri"),marginBottom:8,letterSpacing:"0.06em"}}>
                {displaySess.labelCode||displaySess.boxNumber}
              </p>
              <p style={{fontSize:11,color:C.txt("muted")}}>
                Scan this QR code to view box contents and packing status
              </p>
              <button onClick={()=>setShowQRModal(false)}
                style={{marginTop:20,padding:"8px 24px",borderRadius:9,
                  background:C.navy(),border:"none",color:C.linen(),
                  fontSize:12,fontWeight:700,cursor:"pointer"}}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ HEADER ══════════════════════════════════════════════════ */}
      <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
        borderRadius:16,overflow:"hidden",boxShadow:SH}}>
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>
        <div style={{padding:"14px 20px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            flexWrap:"wrap",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:13}}>
              <div style={{width:46,height:46,borderRadius:12,flexShrink:0,
                background:`linear-gradient(135deg,${C.navy()},${C.steel(0.85)})`,
                display:"flex",alignItems:"center",justifyContent:"center",
                boxShadow:`0 4px 12px ${C.navy(0.38)}`}}>
                <Boxes size={21} color={C.linen()}/>
              </div>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap"}}>
                  <h1 style={{fontSize:17,fontWeight:800,color:C.txt("pri"),letterSpacing:"-0.02em"}}>
                    Final Packing Station
                  </h1>
                  <span style={{fontSize:10,fontWeight:700,color:C.ok(),
                    background:C.ok(0.1),padding:"2px 9px",borderRadius:99,
                    border:`1px solid ${C.ok(0.3)}`,display:"flex",alignItems:"center",gap:4}}>
                    <span style={{width:5,height:5,borderRadius:"50%",background:C.ok(),
                      animation:"pkPulse 1.2s ease-in-out infinite"}}/>LIVE
                  </span>
                </div>
                <p style={{fontSize:11,color:C.txt("muted"),marginTop:3}}>
                  Auto-mapping enabled · Scan QR to lookup box
                </p>
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              {/* QR Icon Button */}
              <button onClick={()=>displaySess&&setShowQRModal(true)} disabled={!displaySess}
                style={{width:36,height:36,borderRadius:9,display:"flex",
                  alignItems:"center",justifyContent:"center",
                  background:C.bg("surf"),border:`1px solid ${C.bdr()}`,
                  cursor:displaySess?"pointer":"not-allowed",
                  color:C.txt("sec"),opacity:displaySess?1:0.5,
                  transition:"all .15s"}}
                title="View Box QR Code">
                <Eye size={14}/>
              </button>

              {/* Box selector */}
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",
                background:C.bg("surf"),border:`1px solid ${C.bdr()}`,borderRadius:10}}>
                <Package size={13} color={C.txt("muted")}/>
                <select value={selectedBox} onChange={handleSelectBox}
                  style={{background:"transparent",border:"none",outline:"none",
                    fontSize:12,fontWeight:700,color:C.txt("pri"),cursor:"pointer",
                    fontFamily:"'DM Mono',monospace"}}>
                  {activeSession&&<option value={activeSession.boxNumber}>{activeSession.boxNumber} — ACTIVE</option>}
                  {(overview.recentSessions||[]).map(s=><option key={s.id} value={s.boxNumber}>{s.boxNumber} — {s.status}</option>)}
                  {!activeSession&&!(overview.recentSessions||[]).length&&<option value="">No box sessions</option>}
                </select>
              </div>

              <button onClick={()=>loadOverview(selectedBox)} disabled={loadingOv}
                style={{width:36,height:36,borderRadius:9,display:"flex",
                  alignItems:"center",justifyContent:"center",
                  background:"transparent",border:`1px solid ${C.bdr()}`,
                  cursor:"pointer",color:C.txt("sec"),opacity:loadingOv?0.5:1}}>
                <RefreshCw size={14} style={{animation:loadingOv?"pkSpin .9s linear infinite":"none"}}/>
              </button>

              <button onClick={handlePrint} disabled={!displaySess}
                style={{display:"inline-flex",alignItems:"center",gap:7,height:36,
                  padding:"0 16px",borderRadius:9,fontSize:12,fontWeight:800,
                  cursor:displaySess?"pointer":"not-allowed",
                  background:displaySess?C.amber():C.idle(0.1),
                  border:"none",color:displaySess?C.navy():C.txt("muted"),
                  boxShadow:displaySess?`0 3px 12px ${C.amber(0.3)}`:"none",
                  opacity:displaySess?1:0.5,transition:"all .15s"}}>
                <Printer size={14}/> Print Label
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ══ SCAN HINT BAR ═══════════════════════════════════════════ */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",
        borderRadius:11,background:scanFlash?C.ok(0.12):C.bg("card"),
        border:`1px solid ${scanFlash?C.ok(0.35):C.bdr()}`,boxShadow:SH,transition:"all .2s"}}>
        <div style={{position:"relative",width:16,height:16,flexShrink:0}}>
          <div style={{position:"absolute",inset:0,borderRadius:"50%",
            background:C.ok(0.4),animation:"pkPing 1.8s ease-out infinite"}}/>
          <div style={{width:16,height:16,borderRadius:"50%",background:C.ok(),
            position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <ScanLine size={9} color="#fff"/>
          </div>
        </div>
        <p style={{fontSize:12,fontWeight:600,color:scanFlash?C.ok():C.txt("muted"),transition:"color .2s"}}>
          {scanFlash?"QR code detected — loading box details…":"Ready to scan — point any barcode or QR scanner at this screen"}
        </p>
      </div>

      {/* ══ MAIN CONTENT ════════════════════════════════════════════ */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:16,alignItems:"start"}}
        className="pk-main-layout">

        {/* ── Left: Box grid + ledger ──────────────────────────── */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>

          {/* Progress strip */}
          <div style={{background:C.bg("card"),border:`1px solid ${C.bdr()}`,
            borderRadius:12,padding:"12px 16px",boxShadow:SH}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              marginBottom:8,flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:13,fontWeight:700,color:C.txt("pri")}}>Box Fill Status</span>
                <Badge v={progressPct>=90?"ok":progressPct>=50?"amber":"idle"}
                  l={`${filledCount} / ${capacity} packed`}/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18,fontWeight:900,color:fillColor,
                  fontFamily:"'DM Mono',monospace"}}>{progressPct}%</span>
                <div style={{display:"flex",gap:3,padding:3,background:C.bg("surf"),
                  border:`1px solid ${C.bdr()}`,borderRadius:7}}>
                  {[{k:"grid",ic:<LayoutGrid size={12}/>},{k:"list",ic:<List size={12}/>}].map(t=>(
                    <button key={t.k} onClick={()=>setView(t.k)}
                      style={{width:28,height:26,borderRadius:5,cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"center",border:"none",
                        background:view===t.k?C.navy():"transparent",
                        color:view===t.k?C.linen():C.txt("muted"),transition:"all .12s"}}>
                      {t.ic}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{height:8,borderRadius:99,background:C.bdr(0.15),overflow:"hidden",
              display:"flex",gap:1}}>
              {Array.from({length:Math.min(capacity,60)},(_,i)=>{
                const filled=filledMap.has(i+1)||i<filledCount;
                return(<div key={i} style={{flex:1,height:"100%",borderRadius:1,
                  background:filled?fillColor:C.bdr(0.2),transition:`background .1s ${i*10}ms`}}/>);
              })}
            </div>
          </div>

          {/* Box Slot Grid */}
          <Card noPad title="Box Slot Map" subtitle="Digital Twin" icon={LayoutGrid}
            accent={C.steel()}
            right={displaySess&&(
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:9,color:C.txt("muted")}}>
                  Box: <strong style={{fontFamily:"'DM Mono',monospace",color:C.txt("pri")}}>
                    {displaySess.boxNumber}
                  </strong>
                </span>
                <Badge v={displaySess?.status==="CLOSED"?"ok":"amber"} l={displaySess?.status||"OPEN"}/>
              </div>
            )}>
            {loadingOv||loadingSess?(
              <div style={{padding:"48px 24px",textAlign:"center"}}>
                <RefreshCw size={22} color={C.txt("muted")} style={{margin:"0 auto 12px",animation:"pkSpin .9s linear infinite"}}/>
                <p style={{fontSize:12,color:C.txt("muted")}}>Loading box data…</p>
              </div>
            ):!displaySess?(
              <div style={{padding:"56px 24px",textAlign:"center"}}>
                <Boxes size={32} color={C.txt("muted")} style={{margin:"0 auto 14px"}}/>
                <p style={{fontSize:13,fontWeight:600,color:C.txt("sec"),marginBottom:6}}>No box selected</p>
                <p style={{fontSize:12,color:C.txt("muted")}}>Select a box from the dropdown or scan a QR code.</p>
              </div>
            ):view==="grid"?(
              <div style={{padding:20}}>
                <div style={{display:"grid",gridTemplateColumns:`repeat(auto-fill,minmax(${boxSize}px,1fr))`,gap:8}}
                  className="pk-box-grid">
                  {Array.from({length:capacity},(_,i)=>{
                    const slotId=i+1;
                    const item=filledMap.get(slotId);
                    const isHov=hoveredSlot===slotId;
                    return(
                      <div key={slotId}
                        onMouseEnter={()=>setHoveredSlot(slotId)}
                        onMouseLeave={()=>setHoveredSlot(null)}
                        style={{
                          position:"relative",
                          height:boxSize,
                          borderRadius:10,
                          border:`1.5px solid ${item?C.ok(0.5):C.bdr(0.22)}`,
                          background:item?`linear-gradient(135deg,${C.ok(0.15)},${C.ok(0.07)})`:C.bg("slot"),
                          display:"flex",flexDirection:"column",
                          alignItems:"center",justifyContent:"center",
                          gap:3,cursor:"default",transition:"all .12s",
                          transform:isHov?"scale(1.05)":"scale(1)",
                          zIndex:isHov?10:1,
                          boxShadow:item?SH:isHov?`0 3px 10px ${C.bdr(0.3)}`:"none",
                        }}>
                        <span style={{fontSize:capacity>80?10:12,fontWeight:900,
                          color:item?C.ok():C.txt("muted"),fontFamily:"'DM Mono',monospace"}}>
                          {slotId}
                        </span>
                        {item?(
                          <div style={{width:6,height:6,borderRadius:"50%",background:C.ok(),
                            boxShadow:`0 0 6px ${C.ok(0.7)}`,animation:"pkPulse 2s ease-in-out infinite"}}/>
                        ):(
                          <span style={{fontSize:7,color:C.txt("muted"),textTransform:"uppercase",fontWeight:600}}>Empty</span>
                        )}
                        {isHov&&item&&(
                          <div style={{position:"absolute",bottom:"calc(100% + 8px)",left:"50%",
                            transform:"translateX(-50%)",background:C.bg("card"),border:`1px solid ${C.ok(0.35)}`,
                            borderRadius:8,padding:"8px 12px",boxShadow:SHM,whiteSpace:"nowrap",zIndex:20,
                            animation:"pkFadeIn .12s ease",minWidth:180}}>
                            <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                              letterSpacing:"0.08em",color:C.ok(),marginBottom:4}}>✓ Slot {slotId}</p>
                            <p style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,
                              color:C.txt("pri"),marginBottom:2}}>{item.partId}</p>
                            <p style={{fontSize:9,color:C.txt("muted")}}>{fmtDT(item.packedAt||item.createdAt)}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:16,marginTop:14,padding:"8px 0",
                  borderTop:`1px solid ${C.bdr()}`,fontSize:10,color:C.txt("muted"),flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:12,height:12,borderRadius:3,background:`linear-gradient(135deg,${C.ok(0.2)},${C.ok(0.08)})`,
                      border:`1.5px solid ${C.ok(0.45)}`}}/>
                    <span>Packed</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:12,height:12,borderRadius:3,background:C.bg("slot"),
                      border:`1.5px solid ${C.bdr(0.22)}`}}/>
                    <span>Empty</span>
                  </div>
                  <span style={{marginLeft:"auto",fontStyle:"italic"}}>Hover for details</span>
                </div>
              </div>
            ):(
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:C.bg("surf"),borderBottom:`1px solid ${C.bdr()}`}}>
                    {["Slot","Part Serial No.","Operation","Result","Packed At"].map(h=>(
                      <th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:9,
                        fontWeight:800,textTransform:"uppercase",letterSpacing:"0.09em",
                        color:C.txt("muted"),whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {displayItems.length===0?(
                      <tr><td colSpan={5} style={{padding:"32px",textAlign:"center",color:C.txt("muted")}}>No parts yet</td></tr>
                    ):displayItems.map((item,i)=>(
                      <tr key={i} style={{borderBottom:`1px solid ${C.bdr()}`,
                        background:i%2===1?C.bg("surf"):"transparent"}}>
                        <td style={{padding:"9px 14px",fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.steel()}}>{item.slotNo||"—"}</td>
                        <td style={{padding:"9px 14px",fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:C.txt("pri")}}>{item.partId||"—"}</td>
                        <td style={{padding:"9px 14px",fontSize:11,color:C.txt("sec")}}>{item.operationNo||"—"}</td>
                        <td style={{padding:"9px 14px"}}><Badge v="ok" l="✓ Pass"/></td>
                        <td style={{padding:"9px 14px",fontSize:10,color:C.txt("muted"),fontFamily:"'DM Mono',monospace"}}>{fmtTime(item.packedAt||item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ── Right Sidebar ──────────────────────────────────────── */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* Status Card */}
          <Card title="Session Overview" subtitle="Packing Metrics" icon={Clock} accent={C.amber()}>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:C.txt("muted")}}>Box Number</span>
                <span style={{fontSize:12,fontFamily:"'DM Mono',monospace",fontWeight:700,color:C.amber()}}>
                  {displaySess?.boxNumber||"—"}
                </span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:C.txt("muted")}}>Status</span>
                <Badge v={displaySess?.status==="CLOSED"?"ok":"wip"} l={displaySess?.status||"OPEN"} pulse={!!activeSession}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:C.txt("muted")}}>Packing Rate</span>
                <span style={{fontSize:12,fontWeight:700,color:C.ok()}}>{eff} pcs/min</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:C.txt("muted")}}>Created</span>
                <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:C.txt("sec")}}>{fmtDT(displaySess?.createdAt)}</span>
              </div>
            </div>
          </Card>

          {/* Quick Actions Card */}
          <Card title="Quick Actions" subtitle="Utilities" icon={Zap} accent={C.steel()}>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <button onClick={handlePrint} disabled={!displaySess}
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                  padding:"8px 12px",borderRadius:9,fontSize:11,fontWeight:700,
                  background:displaySess?C.bg("surf"):C.idle(0.05),border:`1px solid ${C.bdr()}`,
                  cursor:displaySess?"pointer":"not-allowed",color:C.txt(displaySess?"pri":"muted")}}>
                <Printer size={14}/> Print Box Label
              </button>
              <button onClick={()=>displaySess&&setShowQRModal(true)} disabled={!displaySess}
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                  padding:"8px 12px",borderRadius:9,fontSize:11,fontWeight:700,
                  background:displaySess?C.bg("surf"):C.idle(0.05),border:`1px solid ${C.bdr()}`,
                  cursor:displaySess?"pointer":"not-allowed",color:C.txt(displaySess?"pri":"muted")}}>
                <Eye size={14}/> View QR Code
              </button>
            </div>
          </Card>
        </div>
      </div>

      {/* ══ PACKED PARTS TABLE ─────────────────────────────────────── */}
      <Card noPad title={`Packed Parts — ${displayItems.length} of ${capacity} slots filled`}
        subtitle="Live Record" icon={List} accent={C.ok()}
        right={
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 9px",borderRadius:99,
              background:C.ok(0.1),border:`1px solid ${C.ok(0.25)}`}}>
              <div style={{width:5,height:5,borderRadius:"50%",background:C.ok(),animation:"pkPulse 1.2s ease-in-out infinite"}}/>
              <span style={{fontSize:10,fontWeight:700,color:C.ok()}}>{activeSession?"Live":"History"}</span>
            </div>
          </div>
        }>
        {displayItems.length===0?(
          <div style={{padding:"56px 24px",textAlign:"center"}}>
            <Package size={28} color={C.txt("muted")} style={{margin:"0 auto 14px"}}/>
            <p style={{fontSize:13,fontWeight:600,color:C.txt("sec"),marginBottom:6}}>No parts packed yet</p>
          </div>
        ):(
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:`linear-gradient(90deg,${C.navy()},${C.steel(0.9)})`}}>
                {["#","Slot","Part ID","Operation","Station","Machine","QC","Packed At"].map(h=>(
                  <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:8,
                    fontWeight:800,textTransform:"uppercase",letterSpacing:"0.09em",
                    color:C.linen(0.85),whiteSpace:"nowrap"}}>{h}</th>
                ))}
               </tr></thead>
              <tbody>
                {displayItems.map((item,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.bdr()}`,
                    background:i%2===1?C.bg("surf"):"transparent"}}>
                    <td style={{padding:"8px 12px",color:C.txt("muted"),fontSize:9,fontFamily:"'DM Mono',monospace"}}>{i+1}</td>
                    <td style={{padding:"8px 12px"}}><div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:28,height:28,borderRadius:6,background:C.ok(0.1),border:`1px solid ${C.ok(0.3)}`,fontSize:11,fontWeight:800,color:C.ok()}}>{item.slotNo||"—"}</div></td>
                    <td style={{padding:"8px 12px",fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:C.txt("pri")}}>{item.partId||"—"}</td>
                    <td style={{padding:"8px 12px",fontSize:10,color:C.txt("sec")}}>{item.operationNo||"—"}</td>
                    <td style={{padding:"8px 12px",fontSize:10,color:C.txt("muted"),fontFamily:"'DM Mono',monospace"}}>{item.stationNo||"—"}</td>
                    <td style={{padding:"8px 12px",fontSize:10,color:C.txt("pri")}}>{item.machineName||"—"}</td>
                    <td style={{padding:"8px 12px"}}><Badge v="ok" l="Pass"/></td>
                    <td style={{padding:"8px 12px",fontSize:9,color:C.txt("muted"),fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>{fmtTime(item.packedAt||item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default Packing;



