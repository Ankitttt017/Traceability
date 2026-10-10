/* ═══════════════════════════════════════════════════════════════════════════
   Rejection Analysis (management) — every number on the page comes from these pure functions.

   Definitions (agreed with plant management):
     DCM shots          shots made on the die-casting machine (OP100), each shot number once
     Warm-up shots      planned start-up scrap — shown, but NOT in scrap %
     NG shots           shot rejected by the machine (process parameter out of limits) → casting rejection (CR)
     Total Traced       parts first scanned (traced) in the period = Total Pass + Total NG + In Progress
     Total Pass         traced parts that finished OK
     Total NG           traced parts rejected at an inspection station (OP110 … OP160, leak test)
     In Progress        traced parts without a final result yet
     Total rejections   NG shots + Total NG
     Scrap %            total rejections ÷ production, production = the largest of (DCM shots − warm-up),
                        Total Traced, and Total Pass + rejections (shot data has gaps — it starts on 18 Sep 2026 —
                        and dividing by an incomplete shot count inflated scrap, e.g. 13 % instead of ~5 %)
     FPY                Total Pass ÷ (Total Pass + Total NG)
   ═══════════════════════════════════════════════════════════════════════════ */
import { parseRowDefect, formatResultTimestamp, looksLikeCustomerQr } from "../rejectionConstants";
import { CATEGORY_COLOR, CATEGORY_ORDER, SLATE, TARGETS, pctOf } from "../../../components/mgmt/mgmtTheme";

export const PART = { code: "OPK12", name: "OIL PAN K-12", label: "Oil Pan K-12" };

/* ── KPI definitions shown in the (i) popovers — one text for every page ── */
export const DEFINITIONS = {
  shots: { what: "Shots made on the die-casting machine (OP100) in the period, each shot number counted once. This is the start of the process, before parts are traced." },
  traced: {
    what: "Parts traced in the period: every part first scanned in the period, whatever its result so far.",
    formula: ["Total Traced = Total Pass + Total NG + In Progress"],
  },
  pass: { what: "Parts traced in the period that passed every station (final inspection OK)." },
  ng: { what: "Parts traced in the period that were rejected at an inspection station (OP110 – OP160, leak test). NG shots of the die-casting machine are not traced parts and are counted under DCM shots." },
  inProgress: { what: "Parts traced in the period that have no final result yet — still on the line or waiting for the next station." },
  rejections: {
    what: "Every casting lost in the period: shots the machine rejected (process out of limits) plus traced parts rejected at an inspection station (Total NG). Warm-up shots are not counted.",
    formula: ["Total rejections = NG shots + Total NG"],
  },
  scrap: {
    what: "Share of the castings we made (warm-up excluded) that were rejected anywhere — at the die-casting machine or at an inspection station.",
    formula: ["Scrap % = (NG shots + Total NG) ÷ production", "production = the largest of: DCM shots − warm-up, Total Traced, Total Pass + NG shots + Total NG"],
    note: `Target ≤ ${TARGETS.scrapPct}%. Green = on target, amber = within ${TARGETS.amberBandPp} pp, red = worse.`,
  },
  fpy: {
    what: "First-pass yield: share of the finished traced parts (passed or rejected) that came good first time.",
    formula: ["FPY = Total Pass ÷ (Total Pass + Total NG)"],
    note: `Target ≥ ${TARGETS.fpyPct}%. Green = on target, amber = within ${TARGETS.amberBandPp} pp, red = worse.`,
  },
  categories: {
    what: "Split of all rejections by defect category. NG shots count as CR (casting rejection).",
    formula: ["CR = casting rejection (incl. NG shots)", "CRAM = casting defect found after machining (incl. leak test)", "MR = machining rejection"],
  },
  warmUp: { what: "Planned start-up shots after a die change or stop. They are melted again and are shown separately — they are NOT counted as scrap." },
  oee: {
    what: "Overall equipment effectiveness of the line in the period, from the station machine data.",
    formula: ["OEE = availability × performance × quality"],
    note: "Availability = run time ÷ planned time · performance = actual ÷ target output · quality = OK ÷ inspected.",
  },
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const has = (v) => v !== null && v !== undefined;

export const isLeakCode = (c) => {
  const u = String(c || "").toUpperCase();
  return u === "OP150" || u.includes("LEAK");
};
/** "Leak-Test-01" / "Leak Test-03" → "LT-1" / "LT-3" */
export const leakLabel = (code) => {
  const m = String(code || "").match(/(\d+)\s*$/);
  return m ? `LT-${Number(m[1])}` : String(code || "Leak test");
};

export const shiftLetter = (raw) => {
  const s = String(raw || "").trim().toUpperCase().replace(/^SHIFT[_\s-]*/, "");
  return ["A", "B", "C"].includes(s) ? s : null;
};

/* ── Station names in process order ─────────────────────────────────────── */
export const STATIONS = [
  { op: "OP110", name: "OP110 Laser marking", short: "OP110" },
  { op: "OP120", name: "OP120 Casting PDI", short: "OP120" },
  { op: "OP130", name: "OP130 Pre-inspection", short: "OP130" },
  { op: "OP140", name: "OP140 Auto gauging", short: "OP140" },
  { op: "OP150", name: "OP150 Leak test", short: "OP150" },
  { op: "OP160", name: "OP160 Final inspection", short: "OP160" },
];
export const stationName = (op) => STATIONS.find((s) => s.op === op)?.name || op;

/** Station that rejected an NG part record: first OP code of ngGate; leak machine from the station text. */
export function rowStation(r) {
  const gate = String(r?.ngGate || r?.ng_gate || "").toUpperCase();
  const first = (gate.match(/OP\s*\d{3}/) || [])[0]?.replace(/\s/g, "") || "";
  const st = String(r?.ngStation || r?.ng_station || "");
  const m = st.match(/Leak[\s-]*Test[\s-]*0?(\d)/i);
  const leak = m ? `LT-${m[1]}` : null;
  if (leak || first === "OP150" || gate.includes("LEAK")) return { op: "OP150", leak };
  return { op: first || "Unknown", leak: null };
}

/** Parse every NG part record once (category, reason, station). */
export function enrichRows(rows = []) {
  return (rows || []).map((r) => {
    const p = parseRowDefect(r);
    const s = rowStation(r);
    const cat = CATEGORY_ORDER.includes(p.category) ? p.category : "OTHER";
    return { ...r, _cat: cat, _reason: p.reason || "Not recorded", _op: s.op, _leak: s.leak, _parsed: p };
  });
}

/** Station OK / NG from the quality gates (each station counted by its own scan time). Leak machines → one OP150. */
export function gateMap(gates = []) {
  const m = {};
  const leak = [];
  (gates || []).forEach((g) => {
    const code = String(g.code || "").toUpperCase().replace(/\s/g, "");
    const ok = num(g.okCount);
    const ng = num(g.ngCount);
    if (isLeakCode(code)) leak.push({ code: g.code, label: leakLabel(g.code), ok, ng });
    else m[code] = { ok, ng };
  });
  if (leak.length) {
    // the dashboard summary also sends an "OP150" total next to the machines — use the machines, never both
    const machines = leak.some((x) => String(x.code).toUpperCase() !== "OP150")
      ? leak.filter((x) => String(x.code).toUpperCase() !== "OP150")
      : leak;
    machines.sort((a, b) => a.label.localeCompare(b.label));
    m.OP150 = { ok: machines.reduce((a, x) => a + x.ok, 0), ng: machines.reduce((a, x) => a + x.ng, 0), machines };
  }
  return m;
}

export function countBy(list, keyFn) {
  const out = {};
  list.forEach((x) => { const k = keyFn(x); out[k] = (out[k] || 0) + 1; });
  return out;
}

/** Category counts of station NG: from part records when loaded, else from the Pareto API. */
export function stationCategoryCounts(enriched, categoryPareto) {
  if (enriched) {
    const c = countBy(enriched, (r) => r._cat);
    return { CR: c.CR || 0, CRAM: c.CRAM || 0, MR: c.MR || 0, OTHER: c.OTHER || 0 };
  }
  if (Array.isArray(categoryPareto) && categoryPareto.length) {
    const out = { CR: 0, CRAM: 0, MR: 0, OTHER: 0 };
    categoryPareto.forEach((c) => {
      const k = String(c.category || "").toUpperCase();
      out[CATEGORY_ORDER.includes(k) ? k : "OTHER"] += num(c.count);
    });
    return out;
  }
  return null;
}

/* ── Headline KPIs ──────────────────────────────────────────────────────── */
export function computeKpis({ shot, summary, catCounts }) {
  const t = shot?.totals || null;
  const shots = t ? num(t.shots) : null;
  const warmUp = t ? num(t.warmUp) : null;
  const ngShots = t ? num(t.ng) : null;
  const goodShots = t ? num(t.ok) : null;
  // one set of parts — the parts traced (first scanned) in the period: Total Traced = Pass + NG + In Progress
  const traced = summary ? num(summary.totalProduction) : null;
  const totalPass = summary ? num(summary.totalOK) : null;
  const totalNg = summary ? num(summary.totalNG) : null;
  const inProgress = summary ? (has(summary.inProgress) ? num(summary.inProgress) : Math.max(0, traced - totalPass - totalNg)) : null;
  const tracedSum = summary ? totalPass + totalNg + inProgress : null;
  const rejections = has(ngShots) || has(totalNg) ? num(ngShots) + num(totalNg) : null;
  const effShots = has(shots) ? shots - num(warmUp) : null;
  // production base: shot data can be incomplete (gaps, started 18 Sep), so never divide by fewer parts than
  // were actually traced or finished
  const production = Math.max(num(effShots), num(traced), num(totalPass) + num(rejections));
  const scrapPct = has(totalNg) && production > 0 ? (rejections / production) * 100 : null;
  const fpyPct = has(totalPass) && totalPass + totalNg > 0 ? (totalPass / (totalPass + totalNg)) * 100 : null;
  const cats = catCounts
    ? { CR: num(catCounts.CR) + num(ngShots), CRAM: num(catCounts.CRAM), MR: num(catCounts.MR), OTHER: num(catCounts.OTHER) }
    : null;
  return {
    shots, warmUp, ngShots, goodShots, effShots, production, scrapPct, fpyPct, cats, rejections,
    traced, totalPass, totalNg, inProgress, tracedSum, tracedAddsUp: summary ? tracedSum === traced : null,
    // names used by the Excel export and the die / shift tables
    finalOk: totalPass, stationNg: totalNg,
    machine: t?.machine || null,
  };
}

/* ── Trend buckets ──────────────────────────────────────────────────────── */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (d) => {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]} ${MON[Number(m[2]) - 1]}` : String(d || "");
};
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

function placeRows(enriched, ngParts, keyIdx) {
  const where = new Map();
  (ngParts || []).forEach((p) => {
    const k = p[keyIdx];
    if (k === null || k === undefined) return;
    if (p[0] != null) where.set(`id:${p[0]}`, k);
    if (p[1]) where.set(`k:${p[1]}`, k);
    if (p[2]) where.set(`k:${p[2]}`, k);
  });
  const out = {};
  (enriched || []).forEach((r) => {
    const k = where.get(`id:${r.id}`) ?? where.get(`k:${r.part_id || r.partId}`) ?? where.get(`k:${r.customer_qr || r.customerQrCode}`);
    if (k === undefined) return;
    const b = out[k] || (out[k] = { CR: 0, CRAM: 0, MR: 0, OTHER: 0 });
    b[r._cat] += 1;
  });
  return out;
}

/**
 * Daily buckets: NG shots (shot analytics) + station NG (rejection-daily), category split from the NG records.
 * Returns { mode: "day", keys, labels, buckets[] }.
 */
export function buildDailyTrend({ shot, daily, enriched }) {
  const map = {};
  const get = (k) => map[k] || (map[k] = { key: k, shots: 0, warmUp: 0, ngShots: 0, goodShots: 0, produced: 0, ok: 0, stationNg: 0, cats: { CR: 0, CRAM: 0, MR: 0, OTHER: 0 } });
  (shot?.byDay || []).forEach((d) => {
    const b = get(d.day);
    b.shots += num(d.shots); b.warmUp += num(d.warmUp); b.ngShots += num(d.ng); b.goodShots += num(d.ok);
  });
  (daily?.days || []).forEach((r) => {
    if (!r.day) return;
    const b = get(r.day);
    b.produced += num(r.produced); b.ok += num(r.ok); b.stationNg += num(r.ng);
  });
  const placed = enriched ? placeRows(enriched, daily?.ngParts, 3) : {};
  const keys = Object.keys(map).sort();
  const buckets = keys.map((k) => {
    const b = map[k];
    const p = placed[k];
    if (p) Object.assign(b.cats, p);
    const known = b.cats.CR + b.cats.CRAM + b.cats.MR + b.cats.OTHER;
    if (b.stationNg > known) b.cats.OTHER += b.stationNg - known;
    const rej = b.ngShots + b.stationNg;
    const eff = Math.max(b.shots - b.warmUp, b.produced, b.ok + rej);
    b.rejections = rej;
    b.rate = eff > 0 ? (rej / eff) * 100 : null;
    b.fpy = b.ok + b.stationNg > 0 ? (b.ok / (b.ok + b.stationNg)) * 100 : null;
    return b;
  });
  return { mode: "day", keys, labels: keys.map(dayLabel), buckets };
}

/**
 * Hourly buckets for one production day (station rejections only — NG shots are recorded per day).
 * rate = station NG ÷ parts produced in the hour.
 */
export function buildHourlyTrend({ hourly, enriched }) {
  const dayStart = Math.round(num(hourly?.dayRule?.dayStart ?? 21600) / 3600);
  const map = {};
  (hourly?.days || []).forEach((r) => {
    if (r.hour === null || r.hour === undefined) return;
    const h = Number(r.hour);
    const b = map[h] || (map[h] = { key: h, produced: 0, ok: 0, stationNg: 0, ngShots: 0, cats: { CR: 0, CRAM: 0, MR: 0, OTHER: 0 } });
    b.produced += num(r.produced); b.ok += num(r.ok); b.stationNg += num(r.ng);
  });
  const placed = enriched ? placeRows(enriched, hourly?.ngParts, 5) : {};
  const order = (h) => (h - dayStart + 24) % 24;
  const present = Object.keys(map).map(Number);
  if (!present.length) return { mode: "hour", keys: [], labels: [], buckets: [] };
  const lo = Math.min(...present.map(order));
  const hi = Math.max(...present.map(order));
  const keys = [];
  for (let o = lo; o <= hi; o += 1) keys.push((o + dayStart) % 24);
  const buckets = keys.map((h) => {
    const b = map[h] || { key: h, produced: 0, ok: 0, stationNg: 0, ngShots: 0, cats: { CR: 0, CRAM: 0, MR: 0, OTHER: 0 } };
    if (placed[h]) Object.assign(b.cats, placed[h]);
    const known = b.cats.CR + b.cats.CRAM + b.cats.MR + b.cats.OTHER;
    if (b.stationNg > known) b.cats.OTHER += b.stationNg - known;
    b.rejections = b.stationNg;
    b.rate = b.produced > 0 ? (b.stationNg / b.produced) * 100 : null;
    b.fpy = b.ok + b.stationNg > 0 ? (b.ok / (b.ok + b.stationNg)) * 100 : null;
    return b;
  });
  return { mode: "hour", keys, labels: keys.map(hh), buckets };
}

/* ── Pareto of reasons (incl. NG shots as one CR cause) ─────────────────── */
export const NG_SHOT_REASON = "NG shot (DCM out of limits)";
export function buildReasonPareto({ enriched, ngShots, top = 10 }) {
  const byReason = {};
  (enriched || []).forEach((r) => {
    const k = r._reason;
    const b = byReason[k] || (byReason[k] = { label: k, value: 0, cats: {} });
    b.value += 1;
    b.cats[r._cat] = (b.cats[r._cat] || 0) + 1;
  });
  const list = Object.values(byReason).map((b) => {
    const cat = Object.entries(b.cats).sort((a, c) => c[1] - a[1])[0]?.[0] || "OTHER";
    const mixed = Object.keys(b.cats).length > 1;
    return {
      label: b.label, value: b.value, group: cat, color: CATEGORY_COLOR[cat] || CATEGORY_COLOR.OTHER,
      note: mixed ? `Mixed categories: ${Object.entries(b.cats).map(([c, n]) => `${c} ${n}`).join(", ")}` : undefined,
    };
  });
  if (num(ngShots) > 0) {
    list.push({ label: NG_SHOT_REASON, value: num(ngShots), group: "CR", color: CATEGORY_COLOR.CR, note: "Shots the die-casting machine rejected because a process parameter was out of limits (see process root cause)." });
  }
  list.sort((a, b) => b.value - a.value);
  const total = list.reduce((a, x) => a + x.value, 0);
  if (list.length <= top + 1) return { items: list, total };
  const head = list.slice(0, top);
  const rest = list.slice(top);
  head.push({ label: `Other (${rest.length} reasons)`, value: rest.reduce((a, x) => a + x.value, 0), group: "Mixed", color: SLATE[400], note: rest.slice(0, 6).map((x) => `${x.label} ${x.value}`).join(" · ") });
  return { items: head, total };
}

/* ── Station × category matrix ──────────────────────────────────────────── */
export function buildStationMatrix({ enriched, ngShots }) {
  const rows = [];
  rows.push({ key: "DCM", label: "OP100 Die casting (NG shots)", values: { CR: num(ngShots), CRAM: 0, MR: 0 } });
  const byOp = {};
  const leakBy = {};
  (enriched || []).forEach((r) => {
    const o = byOp[r._op] || (byOp[r._op] = { CR: 0, CRAM: 0, MR: 0, OTHER: 0 });
    o[r._cat] += 1;
    if (r._op === "OP150") leakBy[r._leak || "LT-?"] = (leakBy[r._leak || "LT-?"] || 0) + 1;
  });
  STATIONS.forEach((s) => {
    const v = byOp[s.op];
    if (!v && s.op === "OP110") return;
    const sub = s.op === "OP150" && Object.keys(leakBy).length
      ? Object.entries(leakBy).sort().map(([k, n]) => `${k}: ${n}`).join(" · ")
      : undefined;
    rows.push({ key: s.op, label: s.name, sub, values: v || { CR: 0, CRAM: 0, MR: 0 } });
  });
  Object.keys(byOp).filter((op) => !STATIONS.some((s) => s.op === op)).forEach((op) => {
    rows.push({ key: op, label: op === "Unknown" ? "Station not recorded" : op, values: byOp[op] });
  });
  return rows;
}

/* ── Die and shift comparison ───────────────────────────────────────────── */
function rateRow(base) {
  const rejections = num(base.ngShots) + num(base.stationNg);
  const eff = Math.max(has(base.shots) ? base.shots - num(base.warmUp) : 0, num(base.traced ?? base.produced), num(base.finalOk) + rejections);
  return {
    ...base,
    rejections,
    scrapPct: eff > 0 ? (rejections / eff) * 100 : null,
    fpyPct: has(base.finalOk) && base.finalOk + num(base.stationNg) > 0 ? (base.finalOk / (base.finalOk + num(base.stationNg))) * 100 : null,
  };
}

export function buildDieRows({ shot, dieStats }) {
  const map = {};
  const get = (die) => {
    const k = String(die || "—").trim().toUpperCase() || "—";
    return map[k] || (map[k] = { key: k, die: k, machine: null, shots: null, warmUp: null, ngShots: null, finalOk: null, stationNg: null, wip: null });
  };
  (shot?.byDie || []).forEach((d) => {
    const r = get(d.die);
    r.machine = d.machine || r.machine;
    r.shots = num(r.shots) + num(d.shots); r.warmUp = num(r.warmUp) + num(d.warmUp); r.ngShots = num(r.ngShots) + num(d.ng);
  });
  (dieStats || []).forEach((d) => {
    const name = String(d.die_name || d.dieName || "").trim();
    if (!name || /^unknown$/i.test(name) || name === "-") return;
    const r = get(name);
    r.finalOk = num(r.finalOk) + num(d.ok_count ?? d.totalOK);
    r.stationNg = num(r.stationNg) + num(d.ng_count ?? d.totalNG);
    r.wip = num(r.wip) + num(d.totalWIP);
  });
  return Object.values(map).map(rateRow).sort((a, b) => num(b.shots) + num(b.finalOk) - (num(a.shots) + num(a.finalOk)));
}

export function buildShiftRows({ shot, shiftScrap }) {
  const map = {};
  ["A", "B", "C"].forEach((s) => { map[s] = { key: s, shift: s, shots: null, warmUp: null, ngShots: null, finalOk: null, stationNg: null }; });
  (shot?.byShift || []).forEach((d) => {
    const s = shiftLetter(d.shift);
    if (!s) return;
    const r = map[s];
    r.shots = num(r.shots) + num(d.shots); r.warmUp = num(r.warmUp) + num(d.warmUp); r.ngShots = num(r.ngShots) + num(d.ng);
  });
  (shiftScrap || []).forEach((d) => {
    const s = shiftLetter(d.shift);
    if (!s) return;
    const r = map[s];
    r.finalOk = num(r.finalOk) + num(d.ok);
    r.stationNg = num(r.stationNg) + num(d.ng);
  });
  return ["A", "B", "C"].map((s) => rateRow(map[s]));
}

/* ── Defect location hot spots ──────────────────────────────────────────── */
export function hotLocations(viewList = [], limit = 5) {
  const out = [];
  viewList.forEach((v) => (v.zones || []).forEach((z) => {
    let inSubs = 0;
    (z.subZones || []).forEach((s) => {
      inSubs += s.count;
      if (s.count > 0) out.push({ key: `${v.id}-${z.id}-${s.id}`, view: v.name, viewId: v.id, zone: z.name || z.code, sub: s.code || s.name, count: s.count, inferred: s.inferredCount });
    });
    if (z.count - inSubs > 0) out.push({ key: `${v.id}-${z.id}`, view: v.name, viewId: v.id, zone: z.name || z.code, sub: null, count: z.count - inSubs, inferred: Math.max(0, z.inferredCount - (z.subZones || []).reduce((a, s) => a + s.inferredCount, 0)) });
  }));
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}

/* ── Scrap record display fields (table + Excel export) ─────────────────── */
/** Display fields of one NG record (also used by the Excel export). */
export function recordView(r) {
  const rawPid = String(r.partId || r.part_id || "").trim();
  const rawQr = String(r.customerQrCode || r.customer_qr || "").trim();
  const pidIsQr = looksLikeCustomerQr(rawPid) || (rawPid && rawPid === rawQr);
  const p = r._parsed || {};
  const zone = p.zone ? `${String(p.zone).replace(/^ZONE[-\s]*/i, "Zone ")}${p.subZone ? ` › ${p.subZone}` : ""}` : "";
  const time = r.ngRecordedAt || r.final_scan_at || r.createdAt || null;
  return {
    id: r.id ?? r.rowKey ?? `${rawPid}|${rawQr}`,
    partId: !pidIsQr && rawPid && rawPid !== "-" ? rawPid : "—",
    qr: rawQr && rawQr !== "-" ? rawQr : pidIsQr ? rawPid : "—",
    time,
    timeText: time ? formatResultTimestamp(time) : "—",
    shift: shiftLetter(r.shiftCode || r.shift_code) || "—",
    station: r._op === "OP150" && r._leak ? `OP150 Leak test (${r._leak})` : stationName(r._op || "") || "—",
    category: r._cat || "OTHER",
    reason: r._reason || r.reason || "—",
    zone: p.sensorReject ? "Leak sensor" : zone ? `${zone}${p.inferred ? " (inferred)" : ""}` : "—",
    view: p.view || "",
    die: r.dieName || r.die_name || "—",
  };
}

/* ── Process root cause (NG shots vs good shots per machine parameter) ─── */
/** A parameter out of limits on this share (or more) of GOOD shots has limits that carry no signal. */
export const LIMIT_ISSUE_OK_PCT = 25;
/** Minimum gap (pp) between NG and OK shots for a parameter to count as a likely cause. */
export const MIN_LIFT_PP = 1;

/** Split shot-analytics parameters into likely causes (signal), "limit setting issue" and the rest. */
export function processSignals(shot, top = 8) {
  const params = shot?.parameters || [];
  const ng = num(shot?.totalsForParameters?.ngShots ?? shot?.totals?.ng ?? 0);
  const ok = num(shot?.totalsForParameters?.okShots ?? shot?.totals?.ok ?? 0);
  const limitIssue = params.filter((p) => p.okOutPct >= LIMIT_ISSUE_OK_PCT);
  const signal = params.filter((p) => p.okOutPct < LIMIT_ISSUE_OK_PCT && p.lift >= MIN_LIFT_PP).slice(0, top);
  return { params, ng, ok, limitIssue, signal, quiet: params.length - limitIssue.length - signal.length };
}

/* ── Dashboard summary (GET /dashboard/summary) adapters ────────────────── */
/**
 * Inputs for computeKpis() from the dashboard summary. Its totals are for all shifts; with a shift selected the
 * shift's own figures (shiftProduction) are used — stations (qualityGates) already follow the shift filter.
 */
export function dashboardKpiInput(res, shiftCode) {
  const gates = res?.qualityGates || [];
  const s = res?.summary;
  if (!s) return { summary: null, gates };
  const letter = shiftLetter(shiftCode);
  const sp = letter ? res.shiftProduction?.[letter] : null;
  if (letter) {
    const ok = num(sp?.ok), ng = num(sp?.ng), total = num(sp?.total);
    return { gates, summary: { totalOK: ok, totalNG: ng, totalProduction: total, inProgress: Math.max(0, total - ok - ng) } };
  }
  return { gates, summary: { totalOK: s.totalOK, totalNG: s.totalNG, totalProduction: s.totalParts, inProgress: s.totalInProgress } };
}

/** shiftProduction { A: { ok, ng } … } → the shiftScrap rows buildShiftRows() takes. */
export const shiftScrapFromProduction = (sp) => (sp
  ? ["A", "B", "C"].map((l) => ({ shift: `SHIFT_${l}`, ok: num(sp[l]?.ok), ng: num(sp[l]?.ng) }))
  : null);

/** Reason counts [{ reason, category?, count }] → category totals in the categoryPareto shape. */
export const categoryParetoFromDefects = (list) => {
  if (!Array.isArray(list)) return null;
  const out = {};
  list.forEach((d) => {
    const k = String(d.category || "").toUpperCase();
    const c = CATEGORY_ORDER.includes(k) ? k : "OTHER";
    out[c] = (out[c] || 0) + num(d.count);
  });
  return Object.entries(out).map(([category, count]) => ({ category, count }));
};

/**
 * Top reasons from reason counts [{ reason, category?, count }] plus NG shots as one CR reason, biggest first,
 * the rest folded into "Other". categoryOf(reason) fills a missing category.
 */
export function reasonsFromCounts({ list, ngShots, top = 5, categoryOf }) {
  const items = (list || []).filter((d) => num(d.count) > 0).map((d) => {
    const cat = String(d.category || categoryOf?.(d.reason) || "").toUpperCase();
    const c = CATEGORY_ORDER.includes(cat) ? cat : "OTHER";
    return { label: d.reason || "Not recorded", value: num(d.count), group: c === "OTHER" ? "Not classified" : c, color: CATEGORY_COLOR[c] };
  });
  if (num(ngShots) > 0) {
    items.push({ label: NG_SHOT_REASON, value: num(ngShots), group: "CR", color: CATEGORY_COLOR.CR, note: "Shots the die-casting machine rejected because a process parameter was out of limits." });
  }
  items.sort((a, b) => b.value - a.value);
  const total = items.reduce((a, x) => a + x.value, 0);
  if (items.length <= top + 1) return { items, total };
  const rest = items.slice(top);
  return {
    items: [...items.slice(0, top), { label: `Other (${rest.length} reasons)`, value: rest.reduce((a, x) => a + x.value, 0), group: "Mixed", color: SLATE[400], note: rest.slice(0, 6).map((x) => `${x.label} ${x.value}`).join(" · ") }],
    total,
  };
}

/**
 * Change of a KPI vs the previous period.
 * kind "count" → relative change in %, kind "pp" → difference in percentage points.
 * higherIsGood: true / false colours the arrow green or red; null keeps it neutral.
 */
export function kpiChange(cur, prev, { kind = "count", higherIsGood = true, label, fmt = (v) => v } = {}) {
  if (!has(cur) || !has(prev) || !Number.isFinite(Number(cur)) || !Number.isFinite(Number(prev))) return null;
  const diff = Number(cur) - Number(prev);
  let text;
  if (kind === "pp") {
    text = Math.abs(diff) < 0.005 ? "± 0.00 pp" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(2)} pp`;
  } else {
    if (Number(prev) === 0) return Number(cur) === 0 ? { text: "± 0%", tone: "neutral", label, title: `Previous period: ${fmt(prev)}` } : null;
    const pct = (diff / Number(prev)) * 100;
    text = Math.abs(pct) < 0.05 ? "± 0%" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
  }
  const tone = diff === 0 || higherIsGood === null ? "neutral" : (diff > 0) === higherIsGood ? "good" : "bad";
  return { text, tone, label, title: `Previous period: ${fmt(prev)}` };
}

export { pctOf };

