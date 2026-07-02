const test = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('../controllers/reportController');

test('derivePlcShotSummaryFromRows counts unique PLC shot statuses from report rows', () => {
  const summary = _private.derivePlcShotSummaryFromRows([
    { partId: 'P1', plcReading: { shot_number: 101, shot_status: 1, recorded_at: '2026-07-02T06:10:00' } },
    { partId: 'P1', plcReading: { shot_number: 101, shot_status: 1, recorded_at: '2026-07-02T06:10:00' } },
    { partId: 'P2', plcReading: { shot_number: 102, shot_status: 3, recorded_at: '2026-07-02T06:12:00' } },
    { partId: 'P3', plcReading: { shot_number: 103, shot_status: 5, recorded_at: '2026-07-02T06:14:00' } },
  ]);

  assert.deepEqual(summary, {
    totalProduction: 3,
    okShot: 1,
    warmUpShot: 1,
    offShot: 1,
  });
});
