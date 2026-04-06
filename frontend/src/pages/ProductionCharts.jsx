// ============================================================
//  ProductionCharts.jsx — IndusTrace Premium v4
//  ✓ Download bar at TOP
//  ✓ Tabs: Overview | Hourly | Machine | Shift | Parts List
//  ✓ PDF with charts + full parts list table
//  ✓ CSV per tab + Full Audit export
//  ✓ Navy/Steel/Amber/Linen theme
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp, Download, RefreshCw, BarChart3,
  LineChart as LineChartIcon, AlertCircle, Clock,
  Cpu, Target, Activity, FileText, Table2,
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

// ── Canvas chart helpers for PDF ──────────────────────────────────────────
function drawBar(ctx,data,x,y,w,h,okKey="Pass",ngKey="Fail",nameKey="name"){
  if(!data?.length)return;
  const pL=42,pB=24,pT=10,pR=8;
  const cw=w-pL-pR,ch=h-pB-pT;
  const maxV=Math.max(...data.map(d=>(d[okKey]||0)+(d[ngKey]||0)),1);
  ctx.strokeStyle="#e2e8f0";ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){
    const yy=y+pT+ch-(ch/4*i);
    ctx.beginPath();ctx.moveTo(x+pL,yy);ctx.lineTo(x+pL+cw,yy);ctx.stroke();
    ctx.fillStyle="#94a3b8";ctx.font="8px Arial";ctx.textAlign="right";
    ctx.fillText(Math.round(maxV/4*i),x+pL-3,yy+3);
  }
  const slot=cw/data.length,bw=Math.min(28,slot*0.5);
  data.forEach((d,i)=>{
    const ok=d[okKey]||0,ng=d[ngKey]||0;
    const bx=x+pL+slot*i+(slot-bw)/2;
    if(ok>0){const bh=(ok/maxV)*ch;ctx.fillStyle="#22C55E";ctx.fillRect(bx,y+pT+ch-bh,bw*0.48,bh);}
    if(ng>0){const bh=(ng/maxV)*ch;ctx.fillStyle="#EF4444";ctx.fillRect(bx+bw*0.52,y+pT+ch-bh,bw*0.48,bh);}
    const lbl=String(d[nameKey]||d.hour||i).slice(0,8);
    ctx.fillStyle="#64748b";ctx.font="7px Arial";ctx.textAlign="center";
    ctx.fillText(lbl,bx+bw/2,y+pT+ch+14);
  });
  ctx.strokeStyle="#cbd5e1";ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(x+pL,y+pT);ctx.lineTo(x+pL,y+pT+ch);ctx.lineTo(x+pL+cw,y+pT+ch);ctx.stroke();
}

function drawDonut(ctx,cx,cy,r,ok,total){
  const eff=total>0?Math.round(ok/total*100):0;
  const angle=(ok/Math.max(total,1))*Math.PI*2;
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle="#f1f5f9";ctx.fill();
  if(ok>0){ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+angle);ctx.fillStyle="#22C55E";ctx.fill();}
  if(total-ok>0){ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,-Math.PI/2+angle,-Math.PI/2+Math.PI*2);ctx.fillStyle="#EF4444";ctx.fill();}
  ctx.beginPath();ctx.arc(cx,cy,r*0.56,0,Math.PI*2);ctx.fillStyle="#fff";ctx.fill();
  ctx.fillStyle="#1a3263";ctx.font="bold 15px Arial";ctx.textAlign="center";ctx.fillText(`${eff}%`,cx,cy+4);
  ctx.fillStyle="#94a3b8";ctx.font="7px Arial";ctx.fillText("Quality",cx,cy+14);
}

// ── PDF Generator ─────────────────────────────────────────────────────────
async function generatePDF({summary,report,machineMap,efficiency,totalUnits,timeLabel,generatedAt,partsList}){
  // Draw canvas charts
  const W=900,H=480;
  const cv=document.createElement("canvas");cv.width=W;cv.height=H;
  const ctx=cv.getContext("2d");
  if(!ctx)return;
  ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);

  const hourly=(report.hourlyProduction||[]).map(r=>({hour:fmtH(r.hour),Pass:Number(r.ok||0),Fail:Number(r.ng||0)}));
  const mwise=(report.machineWise||[]).map(r=>({name:(machineMap.get(Number(r.machine_id))||`M${r.machine_id}`).slice(0,10),Pass:Number(r.ok||0),Fail:Number(r.ng||0)}));
  const ok=Number(summary.quality?.ok||0),ng=Number(summary.quality?.ng||0);

  // Title labels
  const ttl=(t,x,y)=>{ctx.fillStyle="#1a3263";ctx.font="bold 10px Arial";ctx.textAlign="left";ctx.fillText(t,x,y);};

  ttl("Hourly Production — Pass vs Fail",10,12);
  drawBar(ctx,hourly.slice(0,14),10,18,520,180,"Pass","Fail","hour");

  ttl("Quality Split",560,12);
  drawDonut(ctx,640,105,65,ok,ok+ng);
  ctx.fillStyle="#22C55E";ctx.font="bold 8px Arial";ctx.textAlign="left";ctx.fillText(`✓ Pass: ${ok}`,575,195);
  ctx.fillStyle="#EF4444";ctx.font="bold 8px Arial";ctx.fillText(`✗ Fail: ${ng}`,660,195);

  ttl("Machine-wise Production",10,220);
  drawBar(ctx,mwise,10,228,860,180,"Pass","Fail","name");

  // Shift legend
  ttl("Shift Performance",10,426);
  const shifts=Object.entries(report.shiftProduction||{});
  const maxT=Math.max(...shifts.map(([,v])=>Number(v.total||0)),1);
  shifts.forEach(([sh,row],i)=>{
    const t=Number(row.total||0),ok2=Number(row.ok||0),ng2=t-ok2,e2=t>0?Math.round(ok2/t*100):0;
    const sx=10+i*300,sy=436;
    ctx.fillStyle="#1a3263";ctx.font="bold 8px Arial";ctx.textAlign="left";ctx.fillText(sh.replace("_"," "),sx,sy+7);
    const bw=(t/maxT)*260;
    if(ok2>0){ctx.fillStyle="#22C55E";ctx.fillRect(sx+60,sy,Math.round((ok2/t)*bw)||0,7);}
    if(ng2>0){ctx.fillStyle="#EF4444";ctx.fillRect(sx+60+Math.round((ok2/t)*bw)||0,sy,Math.round((ng2/t)*bw)||0,7);}
    ctx.fillStyle="#64748b";ctx.font="7px Arial";ctx.fillText(`Total:${t}  OK:${ok2}  NG:${ng2}  ${e2}%`,sx+60,sy+18);
  });

  const chartImg=cv.toDataURL("image/png");

  // Build parts rows (max 500 for PDF)
  const partsToShow=(partsList||[]).slice(0,500);
  const partsRows=partsToShow.map((p,i)=>{
    const res=String(p.result||p.status||"").toUpperCase();
    const isOk=["OK","PASS","COMPLETED","ENDED_OK"].includes(res);
    const isNg=["NG","FAIL","FAILED","ENDED_NG","INTERLOCKED"].includes(res);
    const color=isOk?"#22C55E":isNg?"#EF4444":"#94a3b8";
    const label=isOk?"✓ Pass":isNg?"✗ Fail":res||"—";
    return `<tr>
      <td style="color:#94a3b8;font-size:9px">${i+1}</td>
      <td style="font-family:monospace;font-weight:700">${p.partId||"—"}</td>
      <td>${p.batchNo||p.batch||"—"}</td>
      <td>${p.machineName||machineMap.get(Number(p.machineId))||"—"}</td>
      <td>${p.stationNo||p.operationNo||"—"}</td>
      <td style="color:${color};font-weight:700">${label}</td>
      <td style="color:#94a3b8;font-size:9px">${p.interlockReason||p.reason||"—"}</td>
      <td style="font-family:monospace;font-size:9px">${p.createdAt?new Date(p.createdAt).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—"}</td>
    </tr>`;
  }).join("");

  const shiftRows=Object.entries(report.shiftProduction||{}).map(([sh,row])=>{
    const t=Number(row.total||0),ok2=Number(row.ok||0),ng2=t-ok2,e2=t>0?Math.round(ok2/t*100):0;
    return `<tr><td><strong>${sh.replace("_"," ")}</strong></td><td>${t}</td>
      <td style="color:#22C55E;font-weight:700">${ok2}</td>
      <td style="color:#EF4444;font-weight:700">${ng2}</td>
      <td style="font-weight:800;color:${e2>=85?"#22C55E":e2>=60?"#F97316":"#EF4444"}">${e2}%</td></tr>`;
  }).join("");

  const machRows=(report.machineWise||[]).map((row,i)=>{
    const t=(Number(row.ok||0))+(Number(row.ng||0)),e=t>0?Math.round(Number(row.ok||0)/t*100):0;
    const name=machineMap.get(Number(row.machine_id))||`Machine ${row.machine_id}`;
    const bar=`<div style="height:5px;border-radius:3px;background:#f1f5f9;overflow:hidden"><div style="height:100%;background:${e>=85?"#22C55E":e>=60?"#F97316":"#EF4444"};width:${e}%"></div></div>`;
    return `<tr><td style="color:#94a3b8;font-size:9px">${i+1}</td><td><strong>${name}</strong></td>
      <td>${t}</td><td style="color:#22C55E;font-weight:700">${row.ok||0}</td>
      <td style="color:#EF4444;font-weight:700">${row.ng||0}</td>
      <td style="font-weight:800;color:${e>=85?"#22C55E":e>=60?"#F97316":"#EF4444"}">${e}%</td>
      <td>${bar}</td></tr>`;
  }).join("");

  const html=`<!DOCTYPE html><html><head>
<meta charset="UTF-8"/><title>IndusTrace Production Report — ${timeLabel}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#fff;font-size:11px}
.page{max-width:980px;margin:0 auto;padding:24px 30px}

/* Header */
.hdr{background:linear-gradient(135deg,#1a3263,#547792);color:#fff;padding:20px 26px;border-radius:12px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start}
.hdr h1{font-size:19px;font-weight:900;letter-spacing:-.02em;margin-bottom:4px}
.hdr p{font-size:9px;opacity:.75;letter-spacing:.05em}
.badge{font-size:8px;font-weight:700;background:rgba(250,185,91,.25);color:#FAB95B;border:1px solid rgba(250,185,91,.4);padding:2px 10px;border-radius:99px;display:inline-block;margin-top:5px;letter-spacing:.1em}
.hdr-r{text-align:right;font-size:9px;opacity:.85}
.hdr-r strong{display:block;font-size:11px;opacity:1;font-weight:800;margin-bottom:2px}

/* KPIs */
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 11px;border-left:3px solid}
.kpi .lbl{font-size:7px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#94a3b8;margin-bottom:3px}
.kpi .val{font-size:19px;font-weight:900;font-family:monospace;line-height:1;margin-bottom:1px}
.kpi .sub{font-size:7px;color:#94a3b8}

/* Charts */
.chart-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;overflow:hidden;margin-bottom:16px}
.chart-ttl{background:#1a3263;color:#fff;padding:7px 13px;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.09em}

/* Section */
.sec{margin-bottom:14px}
.sec-ttl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#547792;margin-bottom:7px;padding-bottom:4px;border-bottom:1.5px solid #e2e8f0;display:flex;align-items:center;gap:4px}
.sec-ttl::before{content:'';display:inline-block;width:3px;height:10px;background:#1a3263;border-radius:2px}

/* Tables */
table{width:100%;border-collapse:collapse;font-size:10px}
thead tr{background:#1a3263;color:#fff}
thead th{padding:6px 10px;text-align:left;font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
tbody tr:nth-child(even){background:#f8fafc}
tbody td{padding:5px 10px;border-bottom:1px solid #f1f5f9;color:#1e293b;vertical-align:middle}
.tbl{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px}

/* Parts table — compact */
.parts-tbl table{font-size:9px}
.parts-tbl thead th{padding:5px 8px;font-size:6.5px}
.parts-tbl tbody td{padding:4px 8px}

/* 2-col */
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.footer{margin-top:18px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:7px;color:#94a3b8}
.conf{font-size:7px;color:#94a3b8;background:#f8f9fc;border:1px solid #e2e8f0;padding:1px 6px;border-radius:3px;font-family:monospace}

@media print{
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{padding:12px 16px}
  .no-break{page-break-inside:avoid}
  .page-break{page-break-before:always}
}
</style></head>
<body><div class="page">

<div class="hdr">
  <div>
    <h1>Production Quality Report</h1>
    <p>IndusTrace Manufacturing Execution System · Quality Traceability Analytics</p>
    <span class="badge">INDUSTRACE MES</span>
  </div>
  <div class="hdr-r">
    <strong>Period: ${timeLabel}</strong>
    <p>Generated: ${generatedAt}</p>
    <p style="margin-top:4px">Machines: <strong>${summary.machines?.total||0}</strong> total · <strong>${summary.machines?.active||0}</strong> active</p>
    <p style="margin-top:2px"><span class="conf">CONFIDENTIAL — INTERNAL USE</span></p>
  </div>
</div>

<!-- KPI GRID -->
<div class="kpis">
  <div class="kpi" style="border-color:#1a3263"><div class="lbl">Total Produced</div><div class="val" style="color:#1a3263">${totalUnits}</div><div class="sub">Units this period</div></div>
  <div class="kpi" style="border-color:#22C55E"><div class="lbl">Pass (OK)</div><div class="val" style="color:#22C55E">${summary.quality?.ok||0}</div><div class="sub">Quality approved</div></div>
  <div class="kpi" style="border-color:#EF4444"><div class="lbl">Fail (NG)</div><div class="val" style="color:#EF4444">${summary.quality?.ng||0}</div><div class="sub">Failed check</div></div>
  <div class="kpi" style="border-color:${efficiency>=85?"#22C55E":efficiency>=60?"#F97316":"#EF4444"}"><div class="lbl">Quality Rate</div><div class="val" style="color:${efficiency>=85?"#22C55E":efficiency>=60?"#F97316":"#EF4444"}">${efficiency}%</div><div class="sub">Pass / Total</div></div>
  <div class="kpi" style="border-color:#F97316"><div class="lbl">Interlocked</div><div class="val" style="color:#F97316">${summary.parts?.interlocked||0}</div><div class="sub">PLC blocked</div></div>
  <div class="kpi" style="border-color:#547792"><div class="lbl">In Progress</div><div class="val" style="color:#547792">${summary.parts?.inProgress||0}</div><div class="sub">Active parts</div></div>
</div>

<!-- CHARTS -->
<div class="chart-box no-break">
  <div class="chart-ttl">📊 Hourly Production · Machine Performance · Shift Analysis</div>
  <img src="${chartImg}" style="width:100%;display:block;max-height:500px;object-fit:contain"/>
</div>

<!-- SHIFT + PARTS STATUS -->
<div class="two-col">
  <div class="sec no-break">
    <div class="sec-ttl">Shift-wise Performance</div>
    <div class="tbl">
      <table>
        <thead><tr><th>Shift</th><th>Total</th><th>Pass</th><th>Fail</th><th>Quality %</th></tr></thead>
        <tbody>${shiftRows||"<tr><td colspan='5' style='text-align:center;color:#94a3b8;padding:10px'>No data</td></tr>"}</tbody>
      </table>
    </div>
  </div>
  <div class="sec no-break">
    <div class="sec-ttl">Parts Status Summary</div>
    <div class="tbl">
      <table>
        <thead><tr><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          <tr><td>Completed</td><td style="font-weight:800;color:#22C55E">${summary.parts?.completed||0}</td></tr>
          <tr><td>In Progress</td><td style="font-weight:800;color:#547792">${summary.parts?.inProgress||0}</td></tr>
          <tr><td>Interlocked</td><td style="font-weight:800;color:#F97316">${summary.parts?.interlocked||0}</td></tr>
          <tr><td>Rework</td><td style="font-weight:800;color:#EF4444">${summary.parts?.rework||0}</td></tr>
          <tr style="background:#f0fdf4"><td><strong>Total Pass</strong></td><td style="font-weight:900;color:#22C55E">${summary.quality?.ok||0}</td></tr>
          <tr style="background:#fff5f5"><td><strong>Total Fail</strong></td><td style="font-weight:900;color:#EF4444">${summary.quality?.ng||0}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- MACHINE TABLE -->
<div class="sec no-break">
  <div class="sec-ttl">Machine-wise Breakdown</div>
  <div class="tbl">
    <table>
      <thead><tr><th>#</th><th>Machine</th><th>Total</th><th>Pass</th><th>Fail</th><th>Rate</th><th style="min-width:70px">Progress</th></tr></thead>
      <tbody>${machRows||"<tr><td colspan='7' style='text-align:center;color:#94a3b8;padding:12px'>No machine data</td></tr>"}</tbody>
    </table>
  </div>
</div>

<!-- PARTS LIST — new page -->
${partsToShow.length>0?`
<div class="page-break"/>
<div class="sec-ttl" style="margin-top:20px">Production Parts List — ${partsToShow.length} Records (of ${partsList?.length||0} total)</div>
<div class="parts-tbl tbl">
  <table>
    <thead><tr>
      <th>#</th><th>Part Serial No.</th><th>Batch</th><th>Machine</th>
      <th>Station</th><th>Result</th><th>Reason / Remark</th><th>Date & Time</th>
    </tr></thead>
    <tbody>${partsRows}</tbody>
  </table>
</div>
${partsList.length>500?`<p style="font-size:8px;color:#94a3b8;margin-top:6px">Note: Showing first 500 of ${partsList.length} parts. Download CSV for complete list.</p>`:""}
`:""}

<div class="footer">
  <span>IndusTrace MES — Confidential Production Quality Report</span>
  <span>Period: ${timeLabel}</span>
  <span>© ${new Date().getFullYear()} IndusTrace Logic Systems · ${generatedAt}</span>
</div>

</div>
<script>window.onload=function(){setTimeout(function(){window.print();},900);}</script>
</body></html>`;

  const w=window.open("","_blank","width=1080,height=800");
  if(!w){alert("Allow popups to download PDF.");return;}
  w.document.write(html);w.document.close();
}

// ── CSV Exports ────────────────────────────────────────────────────────────
function buildFullCSV({summary,report,machineMap,timeLabel,partsList}){
  const q=s=>`"${String(s||"").replace(/"/g,'""')}"`;
  const nl="\n",L=[];
  const tot=(Number(summary.quality?.ok||0))+(Number(summary.quality?.ng||0));
  const eff=tot>0?Math.round(Number(summary.quality?.ok||0)/tot*100):0;

  L.push("INDUSTRACE PRODUCTION QUALITY REPORT");
  L.push(`Period,${timeLabel}`);
  L.push(`Generated,${fmtNow()}`);
  L.push("");
  L.push("SUMMARY");
  L.push("Metric,Value");
  [["Total Machines",summary.machines?.total||0],["Active Machines",summary.machines?.active||0],
   ["Total Units",tot],["Pass (OK)",summary.quality?.ok||0],["Fail (NG)",summary.quality?.ng||0],
   ["Quality Rate",eff+"%"],["In Progress",summary.parts?.inProgress||0],
   ["Completed",summary.parts?.completed||0],["Interlocked",summary.parts?.interlocked||0],
   ["Rework",summary.parts?.rework||0]].forEach(([m,v])=>L.push(`${m},${v}`));

  L.push("","SHIFT PERFORMANCE");
  L.push("Shift,Total,Pass,Fail,Quality %");
  Object.entries(report.shiftProduction||{}).forEach(([sh,row])=>{
    const t=Number(row.total||0),ok=Number(row.ok||0);
    L.push(`${sh.replace("_"," ")},${t},${ok},${t-ok},${t>0?Math.round(ok/t*100):0}%`);
  });

  L.push("","MACHINE BREAKDOWN");
  L.push("Machine,Total,Pass,Fail,Quality %");
  (report.machineWise||[]).forEach(row=>{
    const t=(Number(row.ok||0))+(Number(row.ng||0)),e=t>0?Math.round(Number(row.ok||0)/t*100):0;
    L.push(`${q(machineMap.get(Number(row.machine_id))||`Machine ${row.machine_id}`)},${t},${row.ok||0},${row.ng||0},${e}%`);
  });

  L.push("","HOURLY PRODUCTION");
  L.push("Hour,Total,Pass,Fail");
  (report.hourlyProduction||[]).forEach(row=>L.push(`${fmtH(row.hour)},${row.total||0},${row.ok||0},${row.ng||0}`));

  if(partsList?.length){
    L.push("","PARTS LIST");
    L.push("#,Part Serial No.,Batch,Machine,Station,Result,Reason / Remark,Date & Time");
    partsList.forEach((p,i)=>{
      const res=String(p.result||p.status||"").toUpperCase();
      const isOk=["OK","PASS","COMPLETED","ENDED_OK"].includes(res);
      const isNg=["NG","FAIL","FAILED","ENDED_NG","INTERLOCKED"].includes(res);
      L.push(`${i+1},${q(p.partId||"")},${q(p.batchNo||p.batch||"")},${q(p.machineName||machineMap.get(Number(p.machineId))||"")},${q(p.stationNo||p.operationNo||"")},${isOk?"Pass":isNg?"Fail":res||"—"},${q(p.interlockReason||p.reason||"")},${q(p.createdAt?new Date(p.createdAt).toLocaleString():"")}`);
    });
  }

  return L.join(nl);
}

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
  const[pdfLoading,setPdfLoading]=useState(false);
  const[error,     setError]     =useState("");
  const[machines,  setMachines]  =useState([]);
  const[partsList, setPartsList] =useState([]);
  const[partsSearch,setPartsSearch]=useState("");
  const[partsFilter,setPartsFilter]=useState("all");

  const[summary,setSummary]=useState({
    machines:{total:0,active:0,inactive:0},
    parts:{inProgress:0,completed:0,ng:0,interlocked:0,rework:0},
    quality:{ok:0,ng:0},
  });
  const[report,setReport]=useState({
    machineWise:[],hourlyProduction:[],
    shiftProduction:{SHIFT_A:{total:0,ok:0,ng:0},SHIFT_B:{total:0,ok:0,ng:0},SHIFT_C:{total:0,ok:0,ng:0}},
  });

  const query=useMemo(()=>{
    if(timeRange==="custom"&&customDate.from&&customDate.to){
      const to=new Date(customDate.to);to.setHours(23,59,59,999);
      return{dateFrom:new Date(customDate.from).toISOString(),dateTo:to.toISOString()};
    }
    return toDateRange(timeRange);
  },[timeRange,customDate]);

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

  const machineMap=useMemo(()=>new Map(machines.map(m=>[Number(m.id),m.machineName])),[machines]);
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
    (report.machineWise||[]).map(r=>({
      name:(machineMap.get(Number(r.machine_id))||`M${r.machine_id}`).slice(0,12),
      Pass:Number(r.ok||0),Fail:Number(r.ng||0),
    })),[machineMap,report.machineWise]);

  const timeLabel=useMemo(()=>{
    if(timeRange==="daily")return"Today";
    if(timeRange==="weekly")return"Last 7 Days";
    if(timeRange==="monthly")return"Last 30 Days";
    if(customDate.from&&customDate.to)return`${customDate.from} to ${customDate.to}`;
    return"Custom";
  },[timeRange,customDate]);

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

  // PDF handler
  const handlePDF=async()=>{
    setPdfLoading(true);
    try{
      await generatePDF({
        summary,report,machineMap,efficiency,totalUnits,
        timeLabel,generatedAt:fmtNow(),partsList,
      });
    }finally{setPdfLoading(false);}
  };

  // CSV handlers
  const handleFullCSV=()=>{
    const csv=buildFullCSV({summary,report,machineMap,timeLabel,partsList});
    downloadBlob(new Blob([csv],{type:"text/csv"}),`IndusTrace_Report_${dateStr()}.csv`);
  };
  const handlePartsCSV=()=>{
    if(!filteredParts.length)return;
    const q=s=>`"${String(s||"").replace(/"/g,'""')}"`;
    const rows=filteredParts.map((p,i)=>{
      const res=String(p.result||p.status||"").toUpperCase();
      const isOk=["OK","PASS","COMPLETED","ENDED_OK"].includes(res);
      const isNg=["NG","FAIL","FAILED","ENDED_NG","INTERLOCKED"].includes(res);
      return`${i+1},${q(p.partId||"")},${q(p.batchNo||p.batch||"")},${q(p.machineName||machineMap.get(Number(p.machineId))||"")},${q(p.stationNo||p.operationNo||"")},${isOk?"Pass":isNg?"Fail":res||"—"},${q(p.interlockReason||p.reason||"")},${q(p.createdAt?new Date(p.createdAt).toLocaleString():"")}`;
    });
    const csv=["#,Part Serial No.,Batch,Machine,Station,Result,Reason,Date & Time",...rows].join("\n");
    downloadBlob(new Blob([csv],{type:"text/csv"}),`Parts_List_${dateStr()}.csv`);
  };
  const handleAPIExport=async()=>{
    try{const b=await dashboardApi.exportReport(query);downloadBlob(b,`IndusTrace_Audit_${dateStr()}.csv`);}
    catch{setError("Audit export failed.");}
  };

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
                  {timeLabel} · {fmtNow()}
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
                <input type="date" value={customDate.from||""}
                  onChange={e=>{setCustomDate(p=>({...p,from:e.target.value}));setTimeRange("custom");}}
                  style={{height:22,background:"transparent",border:"none",fontSize:11,color:C.txt("pri"),outline:"none",cursor:"pointer"}}/>
                <span style={{fontSize:11,color:C.txt("muted")}}>–</span>
                <input type="date" value={customDate.to||""}
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
          {/* Full CSV */}
          <button onClick={handleFullCSV}
            style={{display:"inline-flex",alignItems:"center",gap:6,height:36,padding:"0 14px",
              borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
              background:C.steel(0.1),border:`1px solid ${C.steel(0.3)}`,color:C.steel(),transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background=C.steel(0.2)}
            onMouseLeave={e=>e.currentTarget.style.background=C.steel(0.1)}>
            <Table2 size={13}/> Full CSV
          </button>
          {/* Parts CSV */}
          <button onClick={handlePartsCSV} disabled={!partsList.length}
            style={{display:"inline-flex",alignItems:"center",gap:6,height:36,padding:"0 14px",
              borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
              background:C.ok(0.1),border:`1px solid ${C.ok(0.3)}`,color:C.ok(),
              opacity:partsList.length?1:0.4,transition:"all .15s"}}
            onMouseEnter={e=>{if(partsList.length)e.currentTarget.style.background=C.ok(0.2);}}
            onMouseLeave={e=>e.currentTarget.style.background=C.ok(0.1)}>
            <List size={13}/> Parts CSV
          </button>
          {/* Audit export */}
          <button onClick={handleAPIExport}
            style={{display:"inline-flex",alignItems:"center",gap:6,height:36,padding:"0 14px",
              borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
              background:C.navy(0.08),border:`1px solid ${C.navy(0.22)}`,color:C.navy(),transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background=C.navy(0.16)}
            onMouseLeave={e=>e.currentTarget.style.background=C.navy(0.08)}>
            <Download size={13}/> Audit CSV
          </button>
          {/* PDF */}
          <button onClick={handlePDF} disabled={pdfLoading}
            style={{display:"inline-flex",alignItems:"center",gap:6,height:36,padding:"0 18px",
              borderRadius:8,fontSize:12,fontWeight:800,cursor:pdfLoading?"wait":"pointer",
              background:pdfLoading?C.amber(0.7):C.amber(),
              border:"none",color:C.navy(),
              boxShadow:`0 3px 12px ${C.amber(0.32)}`,transition:"filter .15s"}}
            onMouseEnter={e=>{if(!pdfLoading)e.currentTarget.style.filter="brightness(1.08)";}}
            onMouseLeave={e=>e.currentTarget.style.filter="none"}>
            {pdfLoading
              ?<><RefreshCw size={13} style={{animation:"pcSpin .9s linear infinite"}}/>Building…</>
              :<><FileText size={14}/> PDF Report</>}
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
                  <ResponsiveContainer width="100%" height="100%">
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
                <ResponsiveContainer width="100%" height="100%">
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
                <ResponsiveContainer width="100%" height="100%">
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
                    const name=machineMap.get(Number(row.machine_id))||`Machine ${row.machine_id}`;
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
              <button onClick={handlePartsCSV} disabled={!filteredParts.length}
                style={{display:"inline-flex",alignItems:"center",gap:5,height:32,padding:"0 12px",
                  borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",
                  background:C.ok(0.1),border:`1px solid ${C.ok(0.3)}`,color:C.ok(),
                  opacity:filteredParts.length?1:0.4}}>
                <Download size={11}/> Export CSV
              </button>
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
                      {["#","Part Serial No.","Batch","Machine","Station","Result","Reason / Remark","Date & Time"].map(h=>(
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
                            {p.machineName||machineMap.get(Number(p.machineId))||"—"}
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
                    <button onClick={handlePartsCSV}
                      style={{display:"inline-flex",alignItems:"center",gap:5,height:30,padding:"0 12px",
                        borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer",
                        background:C.steel(0.1),border:`1px solid ${C.steel(0.3)}`,color:C.steel()}}>
                      <Download size={11}/> Download all {filteredParts.length} as CSV
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


