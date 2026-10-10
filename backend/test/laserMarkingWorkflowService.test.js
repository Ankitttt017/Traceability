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
  setWorkflowHooks,
  restoreWorkflowStates,
  getActiveWaitingPart,
  resetWorkflowStateUnlessWaitingForOtherPart,
} = require('../services/laserMarkingWorkflowService');

test('beginWorkflow keeps the waiting part when a different start QR arrives', () => {
  const key = buildWorkflowKey(10, 'OP160');
  beginWorkflow(key, { machineId: 10, stationNo: 'OP160', partId: 'OLD' });
  beginWorkflow(key, { machineId: 10, stationNo: 'OP160', partId: 'NEW' });

  // the part waiting for its customer QR must not be wiped by another part's scan
  const state = getWorkflowState(key);
  assert.equal(state.activePartId, 'OLD');
  assert.equal(state.waitingForCustomerQr, true);
  assert.equal(state.lastError, 'PENDING_CUSTOMER_QR_ACTIVE');
  assert.equal(state.rejectedStartQr, 'NEW');
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

// ---------------------------------------------------------------------------
// SCANNER-FIX tests: waiting-state expiry, persistence/restore, reset safety,
// queue lock held while a timed-out item is still running.
// ---------------------------------------------------------------------------

test('waiting state expires after LASER_CUSTOMER_QR_WAIT_MS and reports it once', () => {
  const key = buildWorkflowKey(50, 'OP110');
  resetWorkflowState(key, { reason: 'TEST_RESET' });
  const expired = [];
  setWorkflowHooks({ onWaitExpired: (snapshot) => expired.push(snapshot.activePartId) });
  process.env.LASER_CUSTOMER_QR_WAIT_MS = '10000';
  try {
    beginWorkflow(key, { machineId: 50, stationNo: 'OP110', partId: '1009090124135' });
    assert.equal(getActiveWaitingPart(key).partId, '1009090124135');
    assert.equal(getActiveWaitingPart(key).source, 'MEMORY');
    // simulate 11 s passing
    getWorkflowState(key).waitingSince = Date.now() - 11000;
    assert.equal(getActiveWaitingPart(key), null);
    const state = getWorkflowState(key);
    assert.equal(state.waitingForCustomerQr, false);
    assert.equal(state.lastError, 'CUSTOMER_QR_WAIT_EXPIRED');
    assert.deepEqual(expired, ['1009090124135']);
    // after expiry a new DPM is accepted (no PENDING_CUSTOMER_QR_ACTIVE block)
    beginWorkflow(key, { machineId: 50, stationNo: 'OP110', partId: '1005181520436' });
    assert.equal(getActiveWaitingPart(key).partId, '1005181520436');
  } finally {
    delete process.env.LASER_CUSTOMER_QR_WAIT_MS;
    setWorkflowHooks({ onWaitExpired: null });
    resetWorkflowState(key, { reason: 'TEST_RESET' });
  }
});

test('a different DPM while a part is waiting does not replace the waiting part', () => {
  const key = buildWorkflowKey(51, 'OP110');
  resetWorkflowState(key, { reason: 'TEST_RESET' });
  beginWorkflow(key, { machineId: 51, stationNo: 'OP110', partId: '1009090124135' });
  beginWorkflow(key, { machineId: 51, stationNo: 'OP110', partId: '1005181520436' });
  assert.equal(getActiveWaitingPart(key).partId, '1009090124135');
  resetWorkflowState(key, { reason: 'TEST_RESET' });
});

test('a blocked/invalid read of another code never wipes the waiting part', () => {
  const key = buildWorkflowKey(52, 'OP110');
  resetWorkflowState(key, { reason: 'TEST_RESET' });
  beginWorkflow(key, { machineId: 52, stationNo: 'OP110', partId: '1009090124135' });
  const reset = resetWorkflowStateUnlessWaitingForOtherPart(key, '0808215822519', { reason: 'START_QR_NOT_ALLOWED' });
  assert.equal(reset, false);
  assert.equal(getActiveWaitingPart(key).partId, '1009090124135');
  // a block of the waiting part itself may reset
  const resetSame = resetWorkflowStateUnlessWaitingForOtherPart(key, '1009090124135', { reason: 'START_QR_NOT_ALLOWED' });
  assert.equal(resetSame, true);
  assert.equal(getActiveWaitingPart(key), null);
});

test('waiting state is persisted on begin/complete and restored after a restart', async () => {
  const saved = [];
  setWorkflowHooks({ persistence: { save: async (snapshot) => { saved.push(snapshot); } } });
  const key = buildWorkflowKey(53, 'OP110');
  try {
    beginWorkflow(key, { machineId: 53, stationNo: 'OP110', partId: '1009090124135' });
    await new Promise((resolve) => setImmediate(resolve));
    const waitingSnapshot = saved.filter((row) => row.key === key).pop();
    assert.equal(waitingSnapshot.waitingForCustomerQr, true);
    assert.equal(waitingSnapshot.activePartId, '1009090124135');

    // a persisted row never overwrites a part already waiting in memory
    const restored = restoreWorkflowStates([{
      workflow_key: key,
      machine_id: 53,
      station_no: 'OP110',
      active_part_id: '0816164128579',
      waiting_for_customer_qr: true,
      waiting_since: new Date(),
    }], Date.now());
    assert.deepEqual(restored, []);
    assert.equal(getActiveWaitingPart(key).partId, '1009090124135');
    resetWorkflowState(key, { reason: 'TEST_RESET' });

    // simulate restart: memory empty for this key, restore from DB-shaped rows

    const freshKey = buildWorkflowKey(54, 'OP110');
    const restoredFresh = restoreWorkflowStates([{
      workflow_key: freshKey,
      machine_id: 54,
      station_no: 'OP110',
      active_part_id: '1005181520436',
      waiting_for_customer_qr: true,
      waiting_since: new Date(Date.now() - 5000),
    }, {
      workflow_key: buildWorkflowKey(55, 'OP110'),
      active_part_id: '0816164128579',
      waiting_for_customer_qr: true,
      waiting_since: new Date(Date.now() - 10 * 60 * 1000), // expired → not restored
    }]);
    assert.deepEqual(restoredFresh, [freshKey]);
    const active = getActiveWaitingPart(freshKey);
    assert.equal(active.partId, '1005181520436');
    assert.equal(active.source, 'PERSISTED');
    assert.equal(getActiveWaitingPart(buildWorkflowKey(55, 'OP110')), null);

    completeWorkflow(freshKey);
    await new Promise((resolve) => setImmediate(resolve));
    const completedSnapshot = saved.filter((row) => row.key === freshKey).pop();
    assert.equal(completedSnapshot.waitingForCustomerQr, false);
  } finally {
    setWorkflowHooks({ persistence: null });
  }
});

test('queue keeps the machine lock while a timed-out item is still running', async () => {
  const key = buildWorkflowKey(60, 'OP110');
  resetWorkflowState(key, { reason: 'TEST_RESET' });
  process.env.LASER_QUEUE_ITEM_TIMEOUT_MS = '5000'; // minimum allowed
  const timeouts = [];
  setWorkflowHooks({ onQueueTimeout: (info) => timeouts.push(info.itemId) });
  const events = [];
  try {
    beginWorkflow(key, { machineId: 60, stationNo: 'OP110', partId: '1009090124135' });
    const first = enqueueLaserWorkflow({
      machineId: 60,
      stationNo: 'OP110',
      payload: 'SLOW',
      processor: async () => {
        events.push('slow-start');
        await new Promise((resolve) => setTimeout(resolve, 5600));
        events.push('slow-end');
      },
    });
    const second = enqueueLaserWorkflow({
      machineId: 60,
      stationNo: 'OP110',
      payload: 'NEXT',
      processor: async () => {
        events.push('next-start');
      },
    });
    await assert.rejects(first, (error) => error.code === 'LASER_QUEUE_TIMEOUT');
    events.push('caller-released');
    await second;
    assert.deepEqual(events, ['slow-start', 'caller-released', 'slow-end', 'next-start']);
    assert.equal(timeouts.length, 1);
    // the outcome of the timed-out item is unknown → state reset for review
    assert.equal(getActiveWaitingPart(key), null);
  } finally {
    delete process.env.LASER_QUEUE_ITEM_TIMEOUT_MS;
    setWorkflowHooks({ onQueueTimeout: null });
  }
});