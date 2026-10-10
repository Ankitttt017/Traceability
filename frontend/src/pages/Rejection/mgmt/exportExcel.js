import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { TARGETS } from "../../../components/mgmt/targets";
import { PART, gateMap, recordView } from "./derive";

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A4A" } };
const pct = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(d)}%`);
const n = (v) => (v === null || v === undefined ? "—" : Number(v));

function styleHeader(row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEAD_FILL;
  row.alignment = { vertical: "middle" };
  row.height = 20;
}

/**
 * Excel: "Summary" (KPIs, station flow, dies, shifts) + "NG records" (every rejected part).
 * k = computeKpis(), gates = summary.qualityGates, dies/shifts = buildDieRows/buildShiftRows (shifts optional)
 */
export async function exportRejectionExcel({ k, gates, dies, shifts, enriched, periodText, shiftText }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Traceability — Rejection Analysis";
  wb.created = new Date();

  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }];
  s.addRow([`Rejection Analysis — ${PART.label} (${PART.code})`]).font = { bold: true, size: 14 };
  s.addRow([`Period: ${periodText}`, "", "", `Shift: ${shiftText}`]);
  s.addRow([`Exported: ${new Date().toLocaleString()}`]);
  s.addRow([]);

  styleHeader(s.addRow(["Key figure", "Value", "Target", "Definition"]));
  [
    ["DCM shots", n(k.shots), "", "Shots on the die-casting machine (OP100)"],
    ["Warm-up shots", n(k.warmUp), "", "Planned start-up shots — not scrap"],
    ["NG shots (CR)", n(k.ngShots), "", "Process parameter out of limits"],
    ["Total Traced", n(k.traced), "", "Parts first scanned in the period = Total Pass + Total NG + In Progress"],
    ["Total Pass", n(k.totalPass), "", "Traced parts that finished OK"],
    ["Total NG", n(k.totalNg), "", "Traced parts rejected at OP110 – OP160 / leak test"],
    ["In Progress", n(k.inProgress), "", "Traced parts without a final result yet"],
    ["Total rejections", n(k.rejections), "", "NG shots + Total NG"],
    ["Scrap %", pct(k.scrapPct), `≤ ${TARGETS.scrapPct}%`, "(NG shots + Total NG) ÷ max(DCM shots − warm-up, Total Traced, Total Pass + rejections)"],
    ["First-pass yield", pct(k.fpyPct), `≥ ${TARGETS.fpyPct}%`, "Total Pass ÷ (Total Pass + Total NG)"],
    ...(k.cats ? [["CR (incl. NG shots)", k.cats.CR], ["CRAM", k.cats.CRAM], ["MR", k.cats.MR]] : []),
  ].forEach((r) => s.addRow(r));
  s.addRow([]);

  styleHeader(s.addRow(["Station", "OK", "NG", "Loss %"]));
  const gm = gateMap(gates);
  ["OP100", "OP110", "OP120", "OP130", "OP140", "OP150", "OP160"].forEach((op) => {
    const g = gm[op];
    if (!g) return;
    const note = op === "OP150" ? " (leak test, 3 machines)" : "";
    s.addRow([`${op}${note}`, g.ok, g.ng, pct(g.ok + g.ng > 0 ? (g.ng / (g.ok + g.ng)) * 100 : null)]);
    (g.machines || []).forEach((m) => s.addRow([`   ${m.label}`, m.ok, m.ng, pct(m.ok + m.ng > 0 ? (m.ng / (m.ok + m.ng)) * 100 : null)]));
  });
  s.addRow([]);

  const cmpHead = ["Shots", "Warm-up", "NG shots", "Station NG", "Final OK", "Scrap %"];
  styleHeader(s.addRow(["Die", ...cmpHead]));
  (dies || []).forEach((d) => s.addRow([d.die, n(d.shots), n(d.warmUp), n(d.ngShots), n(d.stationNg), n(d.finalOk), pct(d.scrapPct)]));
  if (shifts) {
    s.addRow([]);
    styleHeader(s.addRow(["Shift", ...cmpHead]));
    shifts.forEach((d) => s.addRow([`Shift ${d.shift}`, n(d.shots), n(d.warmUp), n(d.ngShots), n(d.stationNg), n(d.finalOk), pct(d.scrapPct)]));
  }

  const r = wb.addWorksheet("NG records", { views: [{ state: "frozen", ySplit: 1 }] });
  r.columns = [
    { header: "Part ID", key: "partId", width: 18 },
    { header: "Customer QR", key: "qr", width: 32 },
    { header: "Rejected at", key: "timeText", width: 22 },
    { header: "Shift", key: "shift", width: 8 },
    { header: "Station", key: "station", width: 26 },
    { header: "Category", key: "category", width: 10 },
    { header: "Reason", key: "reason", width: 32 },
    { header: "View", key: "view", width: 14 },
    { header: "Location", key: "zone", width: 22 },
    { header: "Die", key: "die", width: 8 },
  ];
  styleHeader(r.getRow(1));
  (enriched || []).map(recordView).forEach((v, i) => {
    const row = r.addRow(v);
    if (i % 2) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  });

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf]), `Rejection_Analysis_${PART.code}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  return (enriched || []).length;
}
