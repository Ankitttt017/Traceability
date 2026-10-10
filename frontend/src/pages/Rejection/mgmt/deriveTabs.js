/* ═══════════════════════════════════════════════════════════════════════════
   Derivations used by the Rejection Analysis tabs (quality gates, drill-down, reasons, process analysis).
   Same definitions as ./derive.js (which the Dashboard also uses — keep that file stable).
   ═══════════════════════════════════════════════════════════════════════════ */
import { CATEGORY_ORDER, SLATE } from "../../../components/mgmt/mgmtTheme";
import { NG_SHOT_REASON, STATIONS, isLeakCode, leakLabel, shiftLetter } from "./derive";
import { resolveDefectLocation } from "../rejectionConstants";
import { DAY_START_HOUR, localISODate } from "./periods";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => {
  const m = String(ym || "").match(/^(\d{4})-(\d{2})/);
  return m ? `${MON[Number(m[2]) - 1]} ${m[1]}` : String(ym || "");
};
export const longDayLabel = (d) => {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]} ${MON[Number(m[2]) - 1]} ${m[1]}` : String(d || "");
};

/** Navy ramp for non-status categories (stations, shifts) — status colours stay reserved for target status. */
export const NEUTRAL_RAMP = ["#0f2a4a", "#2b4a73", "#4a6d97", "#7393b8", "#a3bad5", "#5b6b80", "#94a3b8", "#cbd5e1"];
export const SHIFT_COLOR = { A: "#0f2a4a", B: "#4a6d97", C: "#a3bad5", "—": SLATE[400] };

/* ── Quality gates: one bar per station (leak machines separately) ──────── */
/**
 * gates: summary.qualityGates · drill: pareto.qualityGateDrillDown · enriched: NG records (optional)
 * → [{ key, label, name, code (API qualityGate), op, leak, ok, ng, inspected, ngPct, fpyPct, cats }]
 */
export function buildStationBars({ gates = [], drill = null, enriched = null }) {
  const byCode = {};
  (gates || []).forEach((g) => { byCode[String(g.code || "").toUpperCase().replace(/\s/g, "")] = g; });
  const catsFromRows = {};
  (enriched || []).forEach((r) => {
    const k = r._op === "OP150" ? r._leak || "LT-?" : r._op;
    const c = catsFromRows[k] || (catsFromRows[k] = { CR: 0, CRAM: 0, MR: 0, OTHER: 0 });
    c[r._cat] += 1;
  });
  const catsFromDrill = (code) => {
    const d = drill?.[code];
    if (!d) return null;
    const out = { CR: 0, CRAM: 0, MR: 0, OTHER: 0 };
    (d.categories || []).forEach((c) => {
      const k = String(c.category || "").toUpperCase();
      out[CATEGORY_ORDER.includes(k) ? k : "OTHER"] += num(c.count);
    });
    return out;
  };
  const row = (key, label, name, code, g, extra = {}) => {
    const ok = num(g?.okCount);
    const ng = num(g?.ngCount);
    const insp = ok + ng;
    let cats = catsFromRows[key] || (enriched ? null : catsFromDrill(code)) || { CR: 0, CRAM: 0, MR: 0, OTHER: 0 };
    // keep the category split consistent with the station's own NG count
    const known = CATEGORY_ORDER.reduce((a, c) => a + cats[c], 0) + cats.OTHER;
    if (known !== ng && ng > 0) {
      if (known > 0) {
        const f = ng / known;
        cats = Object.fromEntries(Object.entries(cats).map(([c, v]) => [c, Math.round(v * f)]));
        const diff = ng - Object.values(cats).reduce((a, v) => a + v, 0);
        cats.OTHER = Math.max(0, cats.OTHER + diff);
      } else cats = { CR: 0, CRAM: 0, MR: 0, OTHER: ng };
    }
    return { key, label, name, code, op: extra.op || key, leak: extra.leak || null, ok, ng, inspected: insp, ngPct: insp > 0 ? (ng / insp) * 100 : null, fpyPct: insp > 0 ? (ok / insp) * 100 : null, cats, ...extra };
  };
  const out = [];
  STATIONS.forEach((s) => {
    if (s.op === "OP150") {
      const machines = (gates || []).filter((g) => isLeakCode(g.code) && String(g.code).toUpperCase() !== "OP150")
        .map((g) => ({ g, label: leakLabel(g.code) }))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (machines.length) {
        machines.forEach(({ g, label }) => out.push(row(label, label, `OP150 Leak test ${label}`, g.code, g, { op: "OP150", leak: label })));
      } else if (byCode.OP150) out.push(row("OP150", "OP150", s.name, "OP150", byCode.OP150));
      return;
    }
    const g = byCode[s.op];
    if (!g) return;
    out.push(row(s.op, s.op, s.name, s.op, g));
  });
  // OP100 (traced parts) leads the line
  if (byCode.OP100) out.unshift(row("OP100", "OP100", "OP100 Die casting · traced", "OP100", byCode.OP100));
  return out;
}

/* ── Month → day → hour trend ───────────────────────────────────────────── */
/**
 * Months from the daily buckets of buildDailyTrend(). Scrap % of a month only uses the days that have DCM shot
 * data (a day without shots has no denominator); daysNoShots counts the days left out.
 */
export function buildMonthTrend(dayTrend) {
  const map = {};
  (dayTrend?.buckets || []).forEach((b) => {
    const ym = String(b.key).slice(0, 7);
    const m = map[ym] || (map[ym] = {
      key: ym, days: 0, shots: 0, warmUp: 0, ngShots: 0, ok: 0, stationNg: 0, produced: 0, rejections: 0,
      ratedRej: 0, ratedEff: 0, daysNoShots: 0,
    });
    m.days += 1;
    m.shots += b.shots; m.warmUp += b.warmUp; m.ngShots += b.ngShots; m.ok += b.ok; m.stationNg += b.stationNg; m.produced += b.produced;
    m.rejections += b.rejections;
    if (b.shots - b.warmUp > 0) { m.ratedRej += b.rejections; m.ratedEff += b.shots - b.warmUp; } else if (b.rejections > 0 || b.ok > 0) m.daysNoShots += 1;
  });
  const keys = Object.keys(map).sort();
  const buckets = keys.map((k) => {
    const m = map[k];
    m.rate = m.ratedEff > 0 ? (m.ratedRej / m.ratedEff) * 100 : null;
    return m;
  });
  return { mode: "month", keys, labels: keys.map(monthLabel), buckets };
}

/** One station's own output per production day from rejection-daily?qualityGate=… (rows per day × shift). */
export function buildStationDaily(daily) {
  const map = {};
  (daily?.days || []).forEach((r) => {
    if (!r.day) return;
    const b = map[r.day] || (map[r.day] = { key: r.day, produced: 0, ng: 0 });
    b.produced += num(r.produced); b.ng += num(r.ng);
  });
  const keys = Object.keys(map).sort();
  const buckets = keys.map((k) => {
    const b = map[k];
    b.passed = Math.max(0, b.produced - b.ng);
    b.ngPct = b.produced > 0 ? (b.ng / b.produced) * 100 : null;
    return b;
  });
  return { keys, buckets };
}

/* ── Reasons ────────────────────────────────────────────────────────────── */
export function topReasons(enriched, top = 5) {
  const c = {};
  (enriched || []).forEach((r) => { c[r._reason] = (c[r._reason] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, top).map(([reason, count]) => ({ reason, count }));
}

/** Production day (06:00 → 06:00) of a timestamp. */
export const productionDayOf = (t) => {
  const d = t ? new Date(t) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return localISODate(new Date(d.getTime() - DAY_START_HOUR * 3600 * 1000));
};

/**
 * Day of every NG record: the day rejection-daily assigned to the part (same day as the trend totals),
 * else the production day of the rejection time.
 */
/**
 * NG records of the page = the decisive NG scans from rejection-pareto (ngRecords: one per part per gate, the
 * Historical page / plant-sheet rule) shaped like rejection-rows records, so every widget reads the same NG.
 * The NG part rows (rejection-rows, optional) only add details such as die, customer QR and shot.
 */
export function decisiveRows(ngRecords, rows) {
  const byKey = new Map();
  (rows || []).forEach((r) => {
    [r.partId, r.part_id, r.customerQrCode, r.customer_qr].forEach((k) => { const key = String(k || "").trim(); if (key && !byKey.has(key)) byKey.set(key, r); });
  });
  return (ngRecords || []).map((rec) => {
    const base = byKey.get(String(rec.partId || "").trim()) || byKey.get(String(rec.customerQr || "").trim()) || {};
    const reason = rec.reasonCanonical || rec.reason || "";
    const text = rec.interlock || [rec.category && `Category: ${rec.category}`, rec.view && `View: ${rec.view}`, rec.zone && `Zone: ${rec.zone}`, reason && `Reason: ${reason}`].filter(Boolean).join(" | ");
    return {
      ...base,
      id: rec.id, rowKey: rec.id,
      partId: base.partId || rec.partId, part_id: base.part_id || rec.partId,
      customerQrCode: base.customerQrCode || base.customer_qr || rec.customerQr || "",
      die_name: base.die_name || base.dieName || rec.dieName || "", dieName: base.dieName || base.die_name || rec.dieName || "",
      ngGate: rec.op, ng_gate: rec.op, ngStation: rec.station, ng_station: rec.station, station: rec.station, operation_no: rec.op,
      category: rec.category, rejection_category: rec.category,
      reason, rejection_reason: reason, ngReason: text, ng_reason: text, parts_interlock_reason: text,
      view: rec.view, rejection_view: rec.view, rejectionView: rec.view,
      zone: rec.zone, rejection_zone: rec.zone, rejectionZone: rec.zone,
      subZone: undefined, rejection_sub_zone: undefined, rejectionSubZone: undefined,
      shiftCode: rec.shift, shift_code: rec.shift,
      ngRecordedAt: rec.at, createdAt: rec.at,
      status: "NG", overall_status: base.overall_status || "NG",
      _day: rec.day, _shift: shiftLetter(rec.shift), _decisive: true,
    };
  });
}

export function recordDays(enriched, ngParts) {
  const where = new Map();
  (ngParts || []).forEach((p) => {
    if (!p?.[3]) return;
    if (p[0] != null) where.set(`id:${p[0]}`, p[3]);
    if (p[1]) where.set(`k:${p[1]}`, p[3]);
    if (p[2]) where.set(`k:${p[2]}`, p[3]);
  });
  return (enriched || []).map((r) => r._day ?? where.get(`id:${r.id}`) ?? where.get(`k:${r.part_id || r.partId}`)
    ?? where.get(`k:${r.customer_qr || r.customerQrCode}`) ?? productionDayOf(r.ngRecordedAt || r.createdAt));
}

/** Top reasons over the days: { keys, series: [{ name, data }] } (days in the period with at least one record). */
export function buildReasonTrend({ enriched, ngParts, top = 5, dayKeys }) {
  const tops = topReasons(enriched, top).map((x) => x.reason);
  const days = recordDays(enriched, ngParts);
  const per = {};
  (enriched || []).forEach((r, i) => {
    const d = days[i];
    if (!d || !tops.includes(r._reason)) return;
    const m = per[d] || (per[d] = {});
    m[r._reason] = (m[r._reason] || 0) + 1;
  });
  const keys = (dayKeys && dayKeys.length ? dayKeys : Object.keys(per)).slice().sort();
  return { keys, series: tops.map((name) => ({ name, data: keys.map((k) => per[k]?.[name] || 0) })) };
}

/** Reason × station matrix rows for HeatMatrix (top reasons, station columns that have rejections). */
export function buildReasonStationMatrix(enriched, top = 10) {
  const tops = topReasons(enriched, top).map((x) => x.reason);
  const colKey = (r) => (r._op === "OP150" ? r._leak || "OP150" : r._op);
  const cols = new Set();
  const vals = {};
  (enriched || []).forEach((r) => {
    if (!tops.includes(r._reason)) return;
    const c = colKey(r);
    cols.add(c);
    const v = vals[r._reason] || (vals[r._reason] = {});
    v[c] = (v[c] || 0) + 1;
  });
  const order = ["OP110", "OP120", "OP130", "OP140", "OP150", "LT-1", "LT-2", "LT-3", "OP160"];
  const colList = [...cols].sort((a, b) => (order.indexOf(a) + 100 * (order.indexOf(a) < 0)) - (order.indexOf(b) + 100 * (order.indexOf(b) < 0)));
  return { rows: tops.map((r) => ({ key: r, label: r, values: vals[r] || {} })), cols: colList };
}

/** Station NG by shift (records) + NG shots by shift (shot analytics). */
export function buildShiftSplit({ enriched, shot }) {
  const out = { A: 0, B: 0, C: 0, "—": 0 };
  (enriched || []).forEach((r) => { out[shiftLetter(r.shiftCode || r.shift_code) || "—"] += 1; });
  (shot?.byShift || []).forEach((s) => { const l = shiftLetter(s.shift); if (l) out[l] += num(s.ng); });
  return out;
}

/* ── Part-level process analysis (rejection-ml-insights) ────────────────── */
/**
 * Parameters ranked by how differently they behave on NG parts vs OK parts. Parameters without values on one
 * side (mean 0 — not recorded) are left out and counted.
 */
export function mlTopParameters(ml, top = 10) {
  const list = ml?.mlInsights?.features || [];
  const usable = list.filter((f) => num(f.meanOk) !== 0 && num(f.meanNg) !== 0);
  const ranked = usable.slice().sort((a, b) => num(b.importanceScore) - num(a.importanceScore)).slice(0, top).map((f) => ({
    key: f.key, label: f.label, unit: f.unit || "", category: f.category || "",
    meanOk: num(f.meanOk), meanNg: num(f.meanNg), stdOk: num(f.stdOk),
    diffPct: num(f.meanOk) !== 0 ? ((num(f.meanNg) - num(f.meanOk)) / Math.abs(num(f.meanOk))) * 100 : null,
    sigma: num(f.stdOk) > 0 ? (num(f.meanNg) - num(f.meanOk)) / num(f.stdOk) : null,
    importance: num(f.importanceScore), risk: String(f.riskLevel || "").toUpperCase(),
    lsl: f.lsl ?? f.setLowerLimit ?? null, usl: f.usl ?? f.setUpperLimit ?? null,
  }));
  return { ranked, total: list.length, skipped: list.length - usable.length };
}

/* ── Reason lists (side lists, expanded station rows, day drill-down) ──── */
const CAT_KEYS = [...CATEGORY_ORDER, "OTHER"];
const emptyCats = () => ({ CR: 0, CRAM: 0, MR: 0, OTHER: 0 });

/**
 * Every reason of a set of NG records, biggest first, with count and share; ngShots (optional) are added as one CR
 * reason. → { list: [{ reason, count, pct, cat, cats, ngShot? }], total, cats }
 */
export function reasonCounts(records, { ngShots = 0 } = {}) {
  const m = {};
  const cats = emptyCats();
  (records || []).forEach((r) => {
    const b = m[r._reason] || (m[r._reason] = { reason: r._reason, count: 0, cats: {} });
    b.count += 1;
    b.cats[r._cat] = (b.cats[r._cat] || 0) + 1;
    cats[r._cat] += 1;
  });
  const list = Object.values(m).map((b) => ({ ...b, cat: Object.entries(b.cats).sort((a, c) => c[1] - a[1])[0]?.[0] || "OTHER" }));
  if (num(ngShots) > 0) {
    list.push({ reason: NG_SHOT_REASON, count: num(ngShots), cats: { CR: num(ngShots) }, cat: "CR", ngShot: true });
    cats.CR += num(ngShots);
  }
  list.sort((a, b) => b.count - a.count);
  const total = list.reduce((a, x) => a + x.count, 0);
  list.forEach((x) => { x.pct = total > 0 ? (x.count / total) * 100 : 0; });
  return { list, total, cats };
}

/* ── Rejections per day / month by category (CR · CRAM · MR) ───────────── */
/**
 * Station NG records placed on their production day (same day as the daily trend) + NG shots per day (as CR).
 * → { keys, buckets: [{ key, CR, CRAM, MR, OTHER, ngShots, total }], dayOf: day of each record (same order) }
 * Days outside [from, to] are dropped.
 */
export function buildCategoryDays({ enriched, ngParts, shot, from, to }) {
  const inRange = (d) => !!d && (!from || d >= from) && (!to || d <= to);
  const map = {};
  const get = (d) => map[d] || (map[d] = { key: d, ...emptyCats(), ngShots: 0, total: 0 });
  const dayOf = recordDays(enriched, ngParts);
  (enriched || []).forEach((r, i) => { const d = dayOf[i]; if (inRange(d)) get(d)[r._cat] += 1; });
  (shot?.byDay || []).forEach((x) => { if (inRange(x.day) && num(x.ng) > 0) { const b = get(x.day); b.ngShots += num(x.ng); b.CR += num(x.ng); } });
  const keys = Object.keys(map).sort();
  const buckets = keys.map((k) => { const b = map[k]; b.total = CAT_KEYS.reduce((a, c) => a + b[c], 0); return b; });
  return { keys, buckets, dayOf };
}

/** The day buckets above summed per calendar month. */
export function buildCategoryMonths(days) {
  const map = {};
  (days?.buckets || []).forEach((b) => {
    const ym = String(b.key).slice(0, 7);
    const m = map[ym] || (map[ym] = { key: ym, ...emptyCats(), ngShots: 0, total: 0, days: 0 });
    CAT_KEYS.forEach((c) => { m[c] += b[c]; });
    m.ngShots += b.ngShots; m.total += b.total; m.days += 1;
  });
  const keys = Object.keys(map).sort();
  return { keys, buckets: keys.map((k) => map[k]) };
}

/* ── Defect locations on the configured part views ─────────────────────── */
/** Colours for "colour by top reason" on the part map (most frequent located reasons first; the rest grey). */
export const REASON_PALETTE = ["#0f766e", "#b91c1c", "#1d4ed8", "#a16207", "#7e22ce", "#0e7490", "#be185d", "#4d7c0f", "#c2410c", "#475569"];
export const OTHER_REASON_COLOR = "#94a3b8";
const zoneText = (z) => String(z?.name || z?.code || "").replace(/^ZONE[-\s]*/i, "Zone ");

/**
 * Where each record sits on the part views (Rejection Configuration): [{ r, vi, zi, si, sensor }]
 * (vi / zi / si = -1 when not resolved; sensor = leak-test rejection, which has no location).
 */
export function locateRecords(records, views) {
  return (records || []).map((r) => {
    const p = r._parsed || {};
    if (p.sensorReject) return { r, vi: -1, zi: -1, si: -1, sensor: true };
    const loc = resolveDefectLocation(p, views || []);
    return { r, vi: loc.viewIndex, zi: loc.zoneIndex, si: loc.subIndex, sensor: false };
  });
}

/** Located rejections per zone (all views), biggest first: [{ key "vi|zi", vi, zi, view, zone, label, count, cats, cat }]. */
export function zoneCounts(located, views) {
  const m = {};
  (located || []).forEach((x) => {
    if (x.vi < 0 || x.zi < 0) return;
    const key = `${x.vi}|${x.zi}`;
    const v = views[x.vi];
    const z = v?.zones?.[x.zi];
    const b = m[key] || (m[key] = { key, vi: x.vi, zi: x.zi, view: v?.name || "", zone: zoneText(z), count: 0, cats: {} });
    b.count += 1;
    b.cats[x.r._cat] = (b.cats[x.r._cat] || 0) + 1;
  });
  const list = Object.values(m);
  const dupNames = new Set(list.map((b) => b.zone).filter((n, i, a) => a.indexOf(n) !== i));
  return list
    .map((b) => ({ ...b, label: dupNames.has(b.zone) || views.length > 1 ? `${b.zone} · ${b.view}` : b.zone, cat: Object.entries(b.cats).sort((a, c) => c[1] - a[1])[0]?.[0] || "OTHER" }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Reason counts per zone ("vi|zi") and per sub-zone ("vi|zi|si") → { zone: { key: { reason: n } }, sub: { … } }.
 * top(map) → [reason, count, share %] of the dominant reason.
 */
export function locationReasons(located) {
  const zone = {};
  const sub = {};
  (located || []).forEach((x) => {
    if (x.vi < 0 || x.zi < 0) return;
    const zk = `${x.vi}|${x.zi}`;
    const zm = zone[zk] || (zone[zk] = {});
    zm[x.r._reason] = (zm[x.r._reason] || 0) + 1;
    if (x.si >= 0) {
      const sk = `${zk}|${x.si}`;
      const sm = sub[sk] || (sub[sk] = {});
      sm[x.r._reason] = (sm[x.r._reason] || 0) + 1;
    }
  });
  return { zone, sub };
}
export const topOf = (counts) => {
  const e = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!e.length) return null;
  const total = e.reduce((a, x) => a + x[1], 0);
  return { reason: e[0][0], count: e[0][1], pct: (e[0][1] / total) * 100, total, second: e[1] ? { reason: e[1][0], count: e[1][1] } : null };
};

/** Reason × zone matrix (top reasons × top zones of the located records) for HeatMatrix. */
export function buildReasonZoneMatrix(located, views, { topReasons: tr = 10, topZones = 8 } = {}) {
  const zones = zoneCounts(located, views).slice(0, topZones);
  const zKeys = new Set(zones.map((z) => z.key));
  const counts = {};
  (located || []).forEach((x) => {
    if (x.vi < 0 || x.zi < 0) return;
    const c = counts[x.r._reason] || (counts[x.r._reason] = { total: 0, values: {} });
    c.total += 1;
    const zk = `${x.vi}|${x.zi}`;
    if (zKeys.has(zk)) c.values[zk] = (c.values[zk] || 0) + 1;
  });
  const rows = Object.entries(counts).sort((a, b) => b[1].total - a[1].total).slice(0, tr)
    .map(([reason, c]) => ({ key: reason, label: reason, values: c.values }));
  return { rows, zones };
}
