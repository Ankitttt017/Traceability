const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWorkflowKey,
  getWorkflowState,
  resetWorkflowState,
  beginWorkflow,
  completeWorkflow,
  enqueueLaserWorkflow,
  markCustomerQrMapped,
} = require('../services/laserMarkingWorkflowService');

test('beginWorkflow resets stale state before a new start QR', () => {
  const key = buildWorkflowKey(10, 'OP160');
  beginWorkflow(key, { machineId: 10, stationNo: 'OP160', partId: 'OLD' });
  beginWorkflow(key, { machineId: 10, stationNo: 'OP160', partId: 'NEW' });

  const state = getWorkflowState(key);
  assert.equal(state.activePartId, 'NEW');
  assert.equal(state.lastStartQr, 'NEW');
  assert.equal(state.waitingForCustomerQr, true);
  assert.equal(state.status, 'WAITING_CUSTOMER_QR');
});

test('completeWorkflow clears the active laser workflow state', () => {
  const key = buildWorkflowKey(20, 'OP170');
  beginWorkflow(key, { machineId: 20, stationNo: 'OP170', partId: 'PART-1' });
  completeWorkflow(key);

  const state = getWorkflowState(key);
  assert.equal(state.activePartId, '');
  assert.equal(state.waitingForCustomerQr, false);
  assert.equal(state.status, 'READY');
});

test('customer QR mapping uses explicit mapping/completion states', () => {
  const key = buildWorkflowKey(21, 'OP160');
  beginWorkflow(key, { machineId: 21, stationNo: 'OP160', partId: 'PART-1' });
  markCustomerQrMapped(key, { customerQr: 'CUS-1', partId: 'PART-1' });

  const mapped = getWorkflowState(key);
  assert.equal(mapped.status, 'MAPPING');
  assert.equal(mapped.lastCustomerQr, 'CUS-1');

  completeWorkflow(key);
  const completed = getWorkflowState(key);
  assert.equal(completed.status, 'READY');
  assert.equal(completed.activePartId, '');
  assert.equal(completed.lastCustomerQr, '');
});

test('enqueueLaserWorkflow processes same-machine scans sequentially', async () => {
  const key = buildWorkflowKey(30, 'OP160');
  resetWorkflowState(key, { reason: 'TEST_RESET' });

  const seen = [];
  const first = enqueueLaserWorkflow({
    machineId: 30,
    stationNo: 'OP160',
    payload: 'A',
    processor: async () => {
      seen.push('A');
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  });

  const second = enqueueLaserWorkflow({
    machineId: 30,
    stationNo: 'OP160',
    payload: 'B',
    processor: async () => {
      seen.push('B');
    },
  });

  await Promise.all([first, second]);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(seen, ['A', 'B']);
});

test('enqueueLaserWorkflow does not start a second worker while first item is awaiting', async () => {
  const key = buildWorkflowKey(31, 'OP160');
  resetWorkflowState(key, { reason: 'TEST_RESET' });

  let active = 0;
  let maxActive = 0;
  const seen = [];
  const first = enqueueLaserWorkflow({
    machineId: 31,
    stationNo: 'OP160',
    payload: 'A',
    processor: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push('A-start');
      await new Promise((resolve) => setTimeout(resolve, 30));
      seen.push('A-end');
      active -= 1;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = enqueueLaserWorkflow({
    machineId: 31,
    stationNo: 'OP160',
    payload: 'B',
    processor: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push('B-start');
      active -= 1;
    },
  });

  await Promise.all([first, second]);

  assert.equal(maxActive, 1);
  assert.deepEqual(seen, ['A-start', 'A-end', 'B-start']);
});

test('enqueueLaserWorkflow stress-runs normal and QR-only categories simultaneously without reordering each category', async () => {
  const normalKey = buildWorkflowKey(41, 'OP160');
  const qrOnlyKey = buildWorkflowKey(42, 'OP160');
  resetWorkflowState(normalKey, { reason: 'TEST_RESET' });
  resetWorkflowState(qrOnlyKey, { reason: 'TEST_RESET' });

  const normalSeen = [];
  const qrOnlySeen = [];
  let activeNormal = 0;
  let activeQrOnly = 0;
  let observedParallelCategories = false;

  const makeProcessor = (bucket, index, category) => async () => {
    if (category === 'normal') activeNormal += 1;
    else activeQrOnly += 1;
    if (activeNormal > 0 && activeQrOnly > 0) observedParallelCategories = true;
    await new Promise((resolve) => setTimeout(resolve, index % 10 === 0 ? 2 : 0));
    bucket.push(index);
    if (category === 'normal') activeNormal -= 1;
    else activeQrOnly -= 1;
  };

  const work = [];
  for (let index = 0; index < 500; index += 1) {
    work.push(enqueueLaserWorkflow({
      machineId: 41,
      stationNo: 'OP160',
      payload: `NORMAL-${index}`,
      processor: makeProcessor(normalSeen, index, 'normal'),
    }));
    work.push(enqueueLaserWorkflow({
      machineId: 42,
      stationNo: 'OP160',
      payload: `QRONLY-${index}`,
      processor: makeProcessor(qrOnlySeen, index, 'qrOnly'),
    }));
  }

  await Promise.all(work);

  assert.equal(normalSeen.length, 500);
  assert.equal(qrOnlySeen.length, 500);
  assert.deepEqual(normalSeen, Array.from({ length: 500 }, (_, index) => index));
  assert.deepEqual(qrOnlySeen, Array.from({ length: 500 }, (_, index) => index));
  assert.equal(observedParallelCategories, true);
});
