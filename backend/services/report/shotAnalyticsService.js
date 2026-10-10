/**
 * DCM (die-casting machine, OP100) shot analytics for the management views — the FIRST stage of the production
 * funnel: shots made on the machine before any part is traced.
 *
 * Source: PlcCycleReadings (one row per machine shot, written from the DCM PLC).
 *  - recorded_at is the plant's LOCAL wall-clock time (stored without offset), so the production day
 *    (06:00 → next day 06:00) and the shifts are applied to it directly.
 *  - A shot can be stored twice; each (machine, shot_number) counts once (latest row).
 *  - shot_status: 1 = OK shot, 3 = warm-up shot, 5 = NG shot (process parameter out of range) — same buckets as
 *    the Historical Report's "Machine Shot Statistics". NG shots are casting rejections (CR).
 *  - part_name is "<PART>-<DIE>", e.g. "OPK12-S18".
 * Read-only.
 */
const sequelize = require("../../config/db");
const PD = require("../../utils/productionDay");

const OFFSET = PD.PLANT_OFFSET_MIN;

// Process parameters with upper/lower limits on the machine — used to show which ones were out of range on NG shots
const PARAMETERS = [
  ["metal_pressure", "Metal pressure"],
  ["furnace_metal_temp", "Furnace metal temp"],
  ["v1_speed", "V1 speed"],
  ["v2_speed", "V2 speed"],
  ["v3_speed", "V3 speed"],
  ["v4_speed", "V4 speed"],
  ["biscuit_thickness", "Biscuit thickness"],
  ["intensification_time", "Intensification time"],
  ["vacuum_pressure", "Vacuum pressure"],
  ["cooling_water_mov", "Cooling water (moving)"],
  ["cooling_water_sta", "Cooling water (fixed)"],
  ["jet_cooling_pressure", "Jet cooling pressure"],
  ["curing_time", "Curing time"],
  ["pouring_time", "Pouring time"],
  ["shot_fwd_time", "Shot forward time"],
  ["spray_time", "Spray time"],
  ["die_close_core_in_time", "Die close / core in time"],
  ["die_open_core_out_time", "Die open / core out time"],
  ["accel_point", "Acceleration point"],
  ["deaccel_point", "Deceleration point"],
  ["clamp_tonnage", "Clamp tonnage"],
];

let columnCache = null;
async function columns() {
  if (columnCache) return columnCache;
  const rows = await sequelize.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PlcCycleReadings'",
    { type: sequelize.QueryTypes.SELECT },
  );
  columnCache = new Set(rows.map((r) => String(r.COLUMN_NAME).toLowerCase()));
  return columnCache;
}

const BUCKET = `CASE
  WHEN TRY_CONVERT(INT, shot_status) = 1 OR UPPER(CAST(shot_status AS NVARCHAR(20))) IN ('OK','GOOD','PASS','PASSED') THEN 'ok'
  WHEN TRY_CONVERT(INT, shot_status) = 3 OR UPPER(CAST(shot_status AS NVARCHAR(20))) LIKE '%WARM%' THEN 'warmUp'
  WHEN TRY_CONVERT(INT, shot_status) = 5 OR UPPER(CAST(shot_status AS NVARCHAR(20))) IN ('NG','NOK','FAIL','FAILED','REJECTED') THEN 'ng'
  ELSE NULL END`;

/**
 * @param {object} q  dateFrom, dateTo (YYYY-MM-DD production days or ISO), shiftCode (SHIFT_A…), part (default OPK12)
 */
async function getShotAnalytics(q = {}) {
  const shifts = await sequelize.query(
    "SELECT shift_code, start_time, end_time FROM Shifts WHERE is_active = 1",
    { type: sequelize.QueryTypes.SELECT },
  );
  const win = PD.productionWindow({ dateFrom: q.dateFrom, dateTo: q.dateTo, shifts });
  const part = String(q.part || q.partName || "OPK12").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "OPK12";
  const cols = await columns();

  // plant-local window (recorded_at is local time)
  const toLocal = (d) => new Date(d.getTime() + OFFSET * 60000).toISOString().replace("T", " ").replace("Z", "");
  const repl = { from: toLocal(win.from), to: toLocal(win.to), part: `${part}-%`, partExact: part };
  // shift / production-day helpers on the LOCAL column (shiftCaseSql expects UTC → shift it back)
  const utcOf = `DATEADD(MINUTE, -${OFFSET}, s.recorded_at)`;
  const shiftSql = PD.shiftCaseSql(utcOf, shifts);
  const daySql = `CONVERT(char(10), DATEADD(SECOND, -${PD.dayStartSeconds ? PD.dayStartSeconds(shifts) : 21600}, s.recorded_at), 23)`;
  const shiftFilter = q.shiftCode ? ` AND ${shiftSql} = :shift` : "";
  if (q.shiftCode) repl.shift = String(q.shiftCode).trim().toUpperCase();

  const base = `
    WITH raw AS (
      SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.machine_name, r.shot_number ORDER BY r.recorded_at DESC, r.id DESC) rn
      FROM PlcCycleReadings r
      WHERE r.recorded_at >= :from AND r.recorded_at < :to
        AND (UPPER(r.part_name) LIKE :part OR UPPER(r.part_name) = :partExact)
    ), s AS (
      SELECT *, ${BUCKET} AS bucket,
        UPPER(CASE WHEN CHARINDEX('-', part_name) > 0 THEN SUBSTRING(part_name, CHARINDEX('-', part_name) + 1, 20) ELSE '' END) AS die
      FROM raw WHERE rn = 1
    )`;
  const agg = `COUNT(*) shots,
      SUM(CASE WHEN bucket = 'ok' THEN 1 ELSE 0 END) ok,
      SUM(CASE WHEN bucket = 'warmUp' THEN 1 ELSE 0 END) warmUp,
      SUM(CASE WHEN bucket = 'ng' THEN 1 ELSE 0 END) ng`;
  const run = (sql) => sequelize.query(sql, { replacements: repl, type: sequelize.QueryTypes.SELECT });

  const paramCols = PARAMETERS.filter(([c]) => cols.has(c) && cols.has(`${c}_upper_limit`) && cols.has(`${c}_lower_limit`));
  const outOf = (c) => `(TRY_CONVERT(FLOAT, s.${c}_upper_limit) > TRY_CONVERT(FLOAT, s.${c}_lower_limit)
      AND TRY_CONVERT(FLOAT, s.${c}_upper_limit) > 0
      AND (TRY_CONVERT(FLOAT, s.${c}) > TRY_CONVERT(FLOAT, s.${c}_upper_limit) OR TRY_CONVERT(FLOAT, s.${c}) < TRY_CONVERT(FLOAT, s.${c}_lower_limit)))`;
  const paramSelect = paramCols.length
    ? paramCols.map(([c]) => `SUM(CASE WHEN bucket = 'ng' AND ${outOf(c)} THEN 1 ELSE 0 END) AS [ng__${c}],
        SUM(CASE WHEN bucket = 'ok' AND ${outOf(c)} THEN 1 ELSE 0 END) AS [ok__${c}],
        SUM(CASE WHEN TRY_CONVERT(FLOAT, s.${c}_upper_limit) > TRY_CONVERT(FLOAT, s.${c}_lower_limit) AND TRY_CONVERT(FLOAT, s.${c}_upper_limit) > 0 THEN 1 ELSE 0 END) AS [lim__${c}]`).join(",\n")
    : "0 AS none";

  const [totals, byDie, byDay, byShift, params] = await Promise.all([
    run(`${base} SELECT ${agg}, MIN(machine_name) machine, COUNT(DISTINCT machine_name) machines FROM s WHERE bucket IS NOT NULL${shiftFilter}`),
    run(`${base} SELECT die, machine_name machine, ${agg} FROM s WHERE bucket IS NOT NULL${shiftFilter} GROUP BY die, machine_name ORDER BY shots DESC`),
    run(`${base} SELECT ${daySql} day, ${agg} FROM s WHERE bucket IS NOT NULL${shiftFilter} GROUP BY ${daySql} ORDER BY 1`),
    run(`${base} SELECT ${shiftSql} shift, ${agg} FROM s WHERE bucket IS NOT NULL${shiftFilter} GROUP BY ${shiftSql} ORDER BY 1`),
    run(`${base} SELECT SUM(CASE WHEN bucket = 'ng' THEN 1 ELSE 0 END) ngShots, SUM(CASE WHEN bucket = 'ok' THEN 1 ELSE 0 END) okShots, ${paramSelect} FROM s WHERE bucket IS NOT NULL${shiftFilter}`),
  ]);

  const num = (v) => Number(v || 0);
  const shape = (r) => ({ shots: num(r.shots), ok: num(r.ok), warmUp: num(r.warmUp), ng: num(r.ng) });
  const p = params[0] || {};
  const ngShots = num(p.ngShots), okShots = num(p.okShots);
  const parameters = paramCols.map(([c, label]) => ({
    key: c,
    label,
    ngOutOfLimit: num(p[`ng__${c}`]),
    okOutOfLimit: num(p[`ok__${c}`]),
    shotsWithLimit: num(p[`lim__${c}`]),
    ngOutPct: ngShots ? (num(p[`ng__${c}`]) / ngShots) * 100 : 0,
    okOutPct: okShots ? (num(p[`ok__${c}`]) / okShots) * 100 : 0,
    // how much more often the parameter is out of range on NG shots than on OK shots (percentage points).
    // A parameter out of range on every shot (wrong limits on the machine) does not explain NG → lift ≈ 0.
    lift: (ngShots ? (num(p[`ng__${c}`]) / ngShots) * 100 : 0) - (okShots ? (num(p[`ok__${c}`]) / okShots) * 100 : 0),
  })).filter((x) => x.shotsWithLimit > 0)
    .sort((a, b) => b.lift - a.lift || b.ngOutOfLimit - a.ngOutOfLimit);

  return {
    part,
    window: { from: win.from, to: win.to },
    shiftCode: repl.shift || null,
    definitions: {
      shots: "Shots made on the die-casting machine (OP100), each shot number counted once",
      ok: "Good shots (shot status 1)",
      warmUp: "Warm-up shots (status 3) — planned start-up scrap, not production",
      ng: "NG shots (status 5, process parameter out of range) — casting rejection (CR)",
    },
    totals: { ...shape(totals[0] || {}), machine: totals[0]?.machine || null, machines: num(totals[0]?.machines) },
    byDie: byDie.map((r) => ({ die: r.die || "—", machine: r.machine, ...shape(r) })),
    byDay: byDay.map((r) => ({ day: r.day, ...shape(r) })),
    byShift: byShift.map((r) => ({ shift: r.shift, ...shape(r) })),
    parameters,
    totalsForParameters: { ngShots, okShots },
  };
}

module.exports = { getShotAnalytics };
