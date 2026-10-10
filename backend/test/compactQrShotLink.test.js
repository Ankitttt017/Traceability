const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCompactQrPartId,
  resolveCompactQrShotTime,
  selectCompactQrShotRow,
  buildPlcMachineCodeMap,
} = require('../services/report/reportExportService')._compactQrShotLink;

const local = (text) => Date.parse(`${text}Z`); // plant-local wall clock as UTC fields
const row = (machine, shot, recordedAt, extra = {}) => ({
  machine_name: machine,
  shot_number: shot,
  recorded_at: new Date(local(recordedAt)),
  part_name: 'OPK12-S18',
  ...extra,
});

test('parseCompactQrPartId decodes MMDDHHMM + machine code + shot number', () => {
  const parsed = parseCompactQrPartId('1008043522978');
  assert.equal(parsed.month, 10);
  assert.equal(parsed.day, 8);
  assert.equal(parsed.hour, 4);
  assert.equal(parsed.minute, 35);
  assert.equal(parsed.machineCode, '2');
  assert.equal(parsed.shot, 2978);
  assert.equal(parsed.key, '10|8|4|35|2|2978');
});

test('resolveCompactQrShotTime picks the year from the scan date (Dec → Jan safe)', () => {
  const sameYear = resolveCompactQrShotTime(parseCompactQrPartId('1008043522978'), '2026-10-08T05:00:00Z');
  assert.equal(sameYear, local('2026-10-08T04:35:00'));
  // Cast 31 Dec, scanned 1 Jan: the casting belongs to the previous year.
  const decCast = resolveCompactQrShotTime(parseCompactQrPartId('1231235020100'), '2027-01-01T02:00:00Z');
  assert.equal(decCast, local('2026-12-31T23:50:00'));
  // Scan in early Jan of a part cast 2 Jan of the same year.
  const janCast = resolveCompactQrShotTime(parseCompactQrPartId('0102010020100'), '2027-01-02T03:00:00Z');
  assert.equal(janCast, local('2027-01-02T01:00:00'));
  assert.equal(resolveCompactQrShotTime(parseCompactQrPartId('1332043522978'), '2026-10-08T05:00:00Z'), null);
});

test('selectCompactQrShotRow accepts the shot recorded in the next minute and prefers the decoded minute', () => {
  const t = local('2026-10-08T04:35:00');
  const machines = ['UBE 850 T - 02'];
  // Recorded 12 s into the next minute (the case the exact-minute query missed).
  assert.equal(
    selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: machines }, [row('UBE 850 T - 02', 2978, '2026-10-08T04:36:12')])?.recorded_at.toISOString(),
    '2026-10-08T04:36:12.000Z'
  );
  // Decoded minute wins over a neighbour minute; other machines / other shots are ignored.
  const rows = [
    row('UBE 850 T - 02', 2978, '2026-10-08T04:33:30'),
    row('UBE 850 T - 03', 2978, '2026-10-08T04:35:20'),
    row('UBE 850 T - 02', 2978, '2026-10-08T04:35:40'),
    row('UBE 850 T - 02', 2979, '2026-10-08T04:35:10'),
  ];
  assert.equal(selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: machines }, rows).recorded_at.toISOString(), '2026-10-08T04:35:40.000Z');
  // Duplicate rows for the same machine/shot: latest one.
  const dupes = [row('UBE 850 T - 02', 2978, '2026-10-08T04:35:10'), row('UBE 850 T - 02', 2978, '2026-10-08T04:35:50')];
  assert.equal(selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: machines }, dupes).recorded_at.toISOString(), '2026-10-08T04:35:50.000Z');
  // Window edges: −2 min inclusive, decoded minute + 4 min exclusive.
  assert.ok(selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: machines }, [row('UBE 850 T - 02', 2978, '2026-10-08T04:33:00')]));
  assert.equal(selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: machines }, [row('UBE 850 T - 02', 2978, '2026-10-08T04:32:59')]), null);
  assert.ok(selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: machines }, [row('UBE 850 T - 02', 2978, '2026-10-08T04:38:59')]));
  assert.equal(selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: machines }, [row('UBE 850 T - 02', 2978, '2026-10-08T04:39:00')]), null);
  // Same shot number a counter wrap later (days away) is never taken.
  assert.equal(selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: machines }, [row('UBE 850 T - 02', 2978, '2026-10-15T04:35:20')]), null);
  // No machine mapping → any machine (previous behaviour).
  assert.equal(selectCompactQrShotRow({ shot: 2978, timeMs: t, machineNames: null }, [row('UBE 850 T - 03', 2978, '2026-10-08T04:35:20')]).machine_name, 'UBE 850 T - 03');
});

test('buildPlcMachineCodeMap derives code → machine name and honours PLC_MACHINE_CODE_MAP', () => {
  const names = ['UBE 850 T - 01', 'UBE 850 T - 02', 'UBE 850 T-03', 'Unnumbered'];
  const derived = buildPlcMachineCodeMap(names, '');
  assert.deepEqual(derived.get('2'), ['UBE 850 T - 02']);
  assert.deepEqual(derived.get('3'), ['UBE 850 T-03']);
  assert.equal(derived.has('9'), false);
  const overridden = buildPlcMachineCodeMap(names, '{"2":"UBE 850 T - 04","A":["X1","X2"]}');
  assert.deepEqual(overridden.get('2'), ['UBE 850 T - 04']);
  assert.deepEqual(overridden.get('A'), ['X1', 'X2']);
  assert.deepEqual(overridden.get('1'), ['UBE 850 T - 01']);
});
