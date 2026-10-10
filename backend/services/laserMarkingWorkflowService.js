const workflowStates = new Map();
const workflowQueues = new Map();
let queueSequence = 0;

const WORKFLOW_STATE_TTL_MS = Math.max(Number(process.env.LASER_WORKFLOW_STATE_TTL_MS || 60 * 60 * 1000), 5 * 60 * 1000);
const LASER_QUEUE_ITEM_TIMEOUT_MS = Math.max(Number(process.env.LASER_QUEUE_ITEM_TIMEOUT_MS || 20000), 5000);

// ---------------------------------------------------------------------------
// SCANNER-FIX: waiting-state expiry, persistence and queue-lock hooks
// ---------------------------------------------------------------------------
// How long a DPM (Start QR) waits for its Customer QR. After this the wait is
// cleared and the operator must rescan the DPM (the OP110 OperationLog stays
// PENDING, so the rescan is accepted as STATION_ALREADY_IN_PROGRESS and the
// wait restarts). Default 120 s: in the last 14 days 99.86% of real
// DPM→customer-QR mappings happened within 60 s and 99.9% within 120 s.
// Read at call time so tests / ops can change it without a restart.
function getCustomerQrWaitMs() {
  return Math.max(Number(process.env.LASER_CUSTOMER_QR_WAIT_MS || 120000), 10000);
}
// If a timed-out processor never settles, release the machine lock after this
// long anyway (prevents a hung DB call from blocking the station forever).
function getQueueHardReleaseMs() {
  return Math.max(Number(process.env.LASER_QUEUE_HARD_RELEASE_MS || 120000), 10000);
}

const hooks = {
  persistence: null, // { save(snapshot): Promise, remove(key): Promise }
  onWaitExpired: null, // (snapshot) => void
  onQueueTimeout: null, // ({ key, itemId, payload, timeoutMs }) => void
  onQueueHardRelease: null, // ({ key, itemId, payload }) => void
};
const persistChains = new Map();

function setWorkflowHooks(next = {}) {
  Object.assign(hooks, next);
}

function snapshotState(state) {
  return {
    key: state.key,
    machineId: state.machineId,
    stationNo: state.stationNo,
    activePartId: state.activePartId || "",
    waitingForCustomerQr: Boolean(state.waitingForCustomerQr),
    waitingSince: state.waitingSince || null,
    status: state.status,
    lastError: state.lastError || "",
    source: state.source || "MEMORY",
  };
}

/**
 * Fire-and-forget persistence, serialized per key so writes never reorder.
 * Never throws and never blocks the scan path.
 */
function persistState(state) {
  if (!hooks.persistence || !state?.key) return;
  const snapshot = snapshotState(state);
  const previous = persistChains.get(state.key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => hooks.persistence.save(snapshot))
    .catch((error) => {
      console.warn(`[LASER_WORKFLOW] persist failed for ${state.key}: ${error?.message || error}`);
    });
  persistChains.set(state.key, next);
  next.finally(() => {
    if (persistChains.get(state.key) === next) persistChains.delete(state.key);
  });
}

function isWaitExpired(state, now = Date.now()) {
  if (!state?.waitingForCustomerQr || !state.activePartId) return false;
  const since = Number(state.waitingSince || state.lastUpdatedAt || 0);
  return since > 0 && now - since > getCustomerQrWaitMs();
}

/**
 * Restore persisted waiting states after a backend restart. Only states that
 * are still waiting and not expired are restored; they are tagged
 * source=PERSISTED so the trace shows where the active part came from.
 */
function restoreWorkflowStates(rows = [], now = Date.now()) {
  const restored = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.key || row?.workflow_key || "").trim();
    const activePartId = String(row?.activePartId || row?.active_part_id || "").trim();
    const waiting = Boolean(row?.waitingForCustomerQr ?? row?.waiting_for_customer_qr);
    const waitingSince = row?.waitingSince || row?.waiting_since;
    const since = waitingSince ? new Date(waitingSince).getTime() : 0;
    if (!key || !activePartId || !waiting || !since) continue;
    if (now - since > getCustomerQrWaitMs()) continue;
    const existing = workflowStates.get(key);
    // Never overwrite a state that already changed in this process.
    if (existing && (existing.waitingForCustomerQr || existing.lastUpdatedAt > since)) continue;
    workflowStates.set(key, {
      key,
      machineId: row?.machineId ?? row?.machine_id ?? null,
      stationNo: row?.stationNo ?? row?.station_no ?? null,
      activePartId,
      waitingForCustomerQr: true,
      waitingSince: since,
      lastStartQr: activePartId,
      lastCustomerQr: "",
      lastError: "",
      status: "WAITING_CUSTOMER_QR",
      pendingCustomerQr: null,
      source: "PERSISTED",
      lastUpdatedAt: since,
    });
    restored.push(key);
  }
  return restored;
}

/**
 * The part currently waiting for a Customer QR at this key, or null.
 * Applies the expiry. Returns { partId, source, waitingSince }.
 */
function getActiveWaitingPart(key) {
  const state = getWorkflowState(key);
  if (!state.waitingForCustomerQr || !state.activePartId) return null;
  return {
    partId: state.activePartId,
    source: state.source || "MEMORY",
    waitingSince: state.waitingSince || null,
  };
}

/**
 * Reset only when this machine is NOT waiting for a different part. A blocked
 * or invalid read of some other code must never wipe the waiting part
 * (that was how DPM → Customer-QR links were lost). Returns true if reset.
 */
function resetWorkflowStateUnlessWaitingForOtherPart(key, partId, { reason = "RESET" } = {}) {
  const state = getWorkflowState(key);
  const incoming = String(partId || "").trim();
  if (state.waitingForCustomerQr && state.activePartId && state.activePartId !== incoming) {
    state.lastError = `WAIT_PRESERVED_${reason}`;
    return false;
  }
  resetWorkflowState(key, { reason });
  return true;
}

// FIX (diagnostic-only bug): "WAITING_CUSTOMER_QR" -> "COMPLETED" is now a legal
// direct edge. This is the real path taken by the Customer-QR-only-start flow
// (processCustomerQrOnlyStart -> beginWorkflow -> ... -> completeWorkflow),
// which legitimately skips CUSTOMER_QR_RECEIVED/MAPPING because there's no
// separate Start QR + Customer QR handshake in that case — the Customer QR
// itself IS the start. Before this fix, completeWorkflow() still worked
// (it force-sets status="READY" unconditionally at the end), but every
// Case-B scan silently recorded an "illegal transition" against lastError
// internally, polluting the audit trail used for debugging.
const VALID_TRANSITIONS = {
  IDLE: new Set(["START_QR_RECEIVED", "WAITING_CUSTOMER_QR", "CUSTOMER_QR_ONLY_RECEIVED", "RESETTING"]),
  START_QR_RECEIVED: new Set(["WAITING_CUSTOMER_QR", "RESETTING"]),
  WAITING_CUSTOMER_QR: new Set(["CUSTOMER_QR_RECEIVED", "MAPPING", "COMPLETED", "RESETTING"]),
  CUSTOMER_QR_RECEIVED: new Set(["MAPPING", "RESETTING"]),
  CUSTOMER_QR_ONLY_RECEIVED: new Set(["MAPPING", "COMPLETED", "RESETTING"]),
  MAPPING: new Set(["COMPLETED", "RESETTING"]),
  COMPLETED: new Set(["READY", "RESETTING"]),
  READY: new Set(["IDLE", "START_QR_RECEIVED", "CUSTOMER_QR_ONLY_RECEIVED", "RESETTING"]),
  RESETTING: new Set(["IDLE", "READY"]),
};

function buildWorkflowKey(machineId, stationNo) {
  const machineToken = String(machineId || "").trim() || "unknown";
  const stationToken = String(stationNo || "").trim().toUpperCase() || "unknown";
  return `${machineToken}:${stationToken}`;
}

function getWorkflowState(key) {
  if (!workflowStates.has(key)) {
    workflowStates.set(key, {
      key,
      machineId: null,
      stationNo: null,
      activePartId: "",
      waitingForCustomerQr: false,
      lastStartQr: "",
      lastCustomerQr: "",
      lastError: "",
      status: "IDLE",
      pendingCustomerQr: null,
      waitingSince: null,
      source: "MEMORY",
      lastUpdatedAt: Date.now(),
    });
  }
  const state = workflowStates.get(key);
  // SCANNER-FIX: lazy expiry of the Customer-QR wait.
  if (isWaitExpired(state)) {
    const expired = snapshotState(state);
    state.activePartId = "";
    state.waitingForCustomerQr = false;
    state.waitingSince = null;
    state.lastStartQr = "";
    state.pendingCustomerQr = null;
    state.status = "IDLE";
    state.lastError = "CUSTOMER_QR_WAIT_EXPIRED";
    state.expiredPartId = expired.activePartId;
    state.source = "MEMORY";
    state.lastUpdatedAt = Date.now();
    persistState(state);
    try {
      if (hooks.onWaitExpired) hooks.onWaitExpired(expired);
    } catch (_error) {
      // logging hook must never break the scan path
    }
  }
  return state;
}

function transitionWorkflowState(state, nextStatus, { reason = "" } = {}) {
  const current = state.status || "IDLE";
  if (current !== nextStatus && !VALID_TRANSITIONS[current]?.has(nextStatus)) {
    state.lastError = reason || `ILLEGAL_TRANSITION_${current}_TO_${nextStatus}`;
    state.lastUpdatedAt = Date.now();
    return false;
  }
  state.status = nextStatus;
  state.lastError = reason;
  state.lastUpdatedAt = Date.now();
  return true;
}

function resetWorkflowState(key, { reason = "RESET", keepMachineContext = true } = {}) {
  const state = getWorkflowState(key);
  transitionWorkflowState(state, "RESETTING", { reason });
  if (!keepMachineContext) {
    state.machineId = null;
    state.stationNo = null;
  }
  state.activePartId = "";
  state.waitingForCustomerQr = false;
  state.lastStartQr = "";
  state.lastCustomerQr = "";
  state.lastError = reason;
  state.pendingCustomerQr = null;
  state.waitingSince = null;
  state.source = "MEMORY";
  state.status = "IDLE";
  state.lastUpdatedAt = Date.now();
  persistState(state);
  return state;
}

/**
 * FIX (real bug): previously this overwrote `activePartId` with zero checks,
 * so if a second Start QR was scanned at the same machine+station while a
 * previous part was still WAITING_CUSTOMER_QR (i.e. its Customer QR hadn't
 * been scanned yet), the first part's pending journey was silently discarded
 * with no log, no popup, nothing. On a station with two operators/scanners
 * running in parallel, this is exactly the kind of thing that produces
 * "customer QR mapped to the wrong part" symptoms that look random.
 *
 * Now: if we're about to clobber a different part that's still mid-flight,
 * we log a loud, explicit trace warning (`OVERWRITTEN_PENDING_START_QR`) so
 * it's visible in [TCP][TRACE] logs instead of failing silently. Behavior is
 * unchanged otherwise — the new Start QR still wins, since a single
 * machine/station can only physically process one part at a time — but now
 * you'll actually see it happen if operators are scanning out of order.
 */
function beginWorkflow(key, { machineId, stationNo, partId }) {
  const state = getWorkflowState(key);
  const incomingPartId = String(partId || "").trim();
  const hadDifferentPendingPart =
    state.waitingForCustomerQr &&
    state.activePartId &&
    incomingPartId &&
    state.activePartId !== incomingPartId;

  if (hadDifferentPendingPart) {
    console.warn(
      `[LASER_WORKFLOW] Blocking new Start QR at ${key}: previous part ` +
      `"${state.activePartId}" was still WAITING_CUSTOMER_QR when new Start QR ` +
      `"${incomingPartId}" arrived. Complete Customer QR mapping first.`
    );
    state.lastError = "PENDING_CUSTOMER_QR_ACTIVE";
    state.rejectedStartQr = incomingPartId;
    state.lastUpdatedAt = Date.now();
    return state;
  }

  state.machineId = machineId || state.machineId;
  state.stationNo = stationNo || state.stationNo;
  state.activePartId = incomingPartId;
  state.waitingForCustomerQr = Boolean(state.activePartId);
  state.lastStartQr = state.activePartId;
  state.lastCustomerQr = "";
  state.lastError = hadDifferentPendingPart ? "OVERWRITTEN_PENDING_START_QR" : "";
  state.rejectedStartQr = "";
  state.pendingCustomerQr = null;
  state.status = "IDLE";
  if (state.activePartId) {
    transitionWorkflowState(state, "START_QR_RECEIVED", { reason: "START_QR_RECEIVED" });
    transitionWorkflowState(state, "WAITING_CUSTOMER_QR", { reason: "WAITING_CUSTOMER_QR" });
  }
  // SCANNER-FIX: (re)start the expiry clock and persist the wait so a
  // backend restart does not lose it.
  state.waitingSince = state.waitingForCustomerQr ? Date.now() : null;
  state.source = "MEMORY";
  state.lastUpdatedAt = Date.now();
  persistState(state);
  return state;
}

function markCustomerQrMapped(key, { customerQr, partId }) {
  const state = getWorkflowState(key);
  if (state.status === "WAITING_CUSTOMER_QR") {
    transitionWorkflowState(state, "CUSTOMER_QR_RECEIVED", { reason: "CUSTOMER_QR_RECEIVED" });
  }
  transitionWorkflowState(state, "MAPPING", { reason: "CUSTOMER_QR_MAPPING" });
  state.lastCustomerQr = String(customerQr || "").trim();
  state.lastError = "";
  state.lastUpdatedAt = Date.now();
  if (partId) {
    state.activePartId = String(partId || "").trim();
  }
  return state;
}

function completeWorkflow(key) {
  const state = getWorkflowState(key);
  if (state.status !== "COMPLETED") {
    transitionWorkflowState(state, "COMPLETED", { reason: "WORKFLOW_COMPLETED" });
  }
  state.activePartId = "";
  state.waitingForCustomerQr = false;
  state.lastCustomerQr = "";
  state.lastError = "";
  state.pendingCustomerQr = null;
  state.waitingSince = null;
  state.source = "MEMORY";
  state.status = "READY";
  state.lastUpdatedAt = Date.now();
  persistState(state);
  return state;
}

/**
 * SCANNER-FIX: run one queue item with a timeout WITHOUT releasing the
 * machine lock while the timed-out work is still running.
 *
 * Before: Promise.race() rejected after the timeout and the drain loop
 * immediately started the next item while the first one was still writing
 * to the DB → two scans processed concurrently for the same machine.
 *
 * Now: on timeout the caller's promise is rejected (so the TCP side is not
 * stuck), the workflow state of that machine is reset (the outcome of the
 * timed-out item is unknown) and an onQueueTimeout hook logs it for review,
 * but the drain loop keeps waiting for the work to settle (bounded by
 * LASER_QUEUE_HARD_RELEASE_MS) before the next item starts.
 */
function runWithTimeout(work, timeoutMs, item) {
  let timeoutId = null;
  let hardReleaseId = null;
  let timedOut = false;
  const workPromise = Promise.resolve().then(() => work());
  const settled = workPromise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );

  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      const error = new Error(`Laser workflow queue item ${item.id} timed out after ${timeoutMs}ms`);
      error.code = "LASER_QUEUE_TIMEOUT";
      resolve({ timeoutError: error });
    }, timeoutMs);
  });

  return Promise.race([settled, timeout]).then(async (first) => {
    if (timeoutId) clearTimeout(timeoutId);
    if (!first.timeoutError) {
      if (first.error) throw first.error;
      return first.value;
    }
    // Timed out: tell the caller now, keep the lock until the work settles.
    item.timedOut = true;
    try {
      resetWorkflowState(item.key, { reason: "LASER_QUEUE_TIMEOUT" });
      if (hooks.onQueueTimeout) hooks.onQueueTimeout({ key: item.key, itemId: item.id, payload: item.payload, timeoutMs });
    } catch (_error) {
      // never break the queue because of logging
    }
    item.reject(first.timeoutError);
    item.rejectedEarly = true;
    const hardRelease = new Promise((resolve) => {
      hardReleaseId = setTimeout(() => resolve({ hardRelease: true }), getQueueHardReleaseMs());
    });
    const late = await Promise.race([settled, hardRelease]);
    if (hardReleaseId) clearTimeout(hardReleaseId);
    if (late.hardRelease) {
      try {
        if (hooks.onQueueHardRelease) hooks.onQueueHardRelease({ key: item.key, itemId: item.id, payload: item.payload });
      } catch (_error) {
        // ignore
      }
      console.error(`[LASER_WORKFLOW] Queue item ${item.id} at ${item.key} still running after hard-release window; releasing machine lock.`);
    }
    throw first.timeoutError;
  }).finally(() => {
    if (timeoutId && !timedOut) clearTimeout(timeoutId);
  });
}

async function drainLaserWorkflowQueue(key) {
  const queueState = workflowQueues.get(key);
  if (!queueState || queueState.processing) return;

  queueState.processing = true;
  try {
    while (queueState.items.length > 0) {
      const current = queueState.items.shift();
      if (!current) continue;

      current.status = "PROCESSING";
      current.startedAt = Date.now();
      try {
        await runWithTimeout(() => current.processor(current), current.timeoutMs, current);
        current.status = "DONE";
        current.completedAt = Date.now();
      } catch (error) {
        current.status = error?.code === "LASER_QUEUE_TIMEOUT" ? "TIMEOUT" : "ERROR";
        current.completedAt = Date.now();
        const state = getWorkflowState(current.key);
        state.lastError = error?.message || "PROCESSING_FAILED";
        state.lastUpdatedAt = Date.now();
        if (!current.rejectedEarly) current.reject(error);
        continue;
      }
      current.resolve(current);
    }
  } finally {
    queueState.processing = false;
    if (queueState.items.length > 0) {
      setImmediate(() => drainLaserWorkflowQueue(key));
    } else {
      workflowQueues.delete(key);
      cleanupInactiveWorkflowStates();
    }
  }
}

async function enqueueLaserWorkflow({ machineId, stationNo, payload, processor }) {
  const key = buildWorkflowKey(machineId, stationNo);
  const queueState = workflowQueues.get(key) || { key, items: [], processing: false };
  workflowQueues.set(key, queueState);

  let resolveItem;
  let rejectItem;
  const promise = new Promise((resolve, reject) => {
    resolveItem = resolve;
    rejectItem = reject;
  });
  const item = {
    id: ++queueSequence,
    key,
    payload,
    status: "QUEUED",
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    timeoutMs: Math.max(Number(process.env.LASER_QUEUE_ITEM_TIMEOUT_MS || LASER_QUEUE_ITEM_TIMEOUT_MS), 5000),
    processor,
    resolve: resolveItem,
    reject: rejectItem,
  };
  queueState.items.push(item);
  setImmediate(() => drainLaserWorkflowQueue(key));
  return promise;
}

function cleanupInactiveWorkflowStates(now = Date.now()) {
  for (const [key, state] of workflowStates.entries()) {
    const idleLike = !state.waitingForCustomerQr && !state.activePartId && ["IDLE", "READY"].includes(state.status);
    if (idleLike && now - Number(state.lastUpdatedAt || 0) > WORKFLOW_STATE_TTL_MS) {
      workflowStates.delete(key);
    }
  }
}

module.exports = {
  buildWorkflowKey,
  getWorkflowState,
  transitionWorkflowState,
  resetWorkflowState,
  beginWorkflow,
  markCustomerQrMapped,
  completeWorkflow,
  enqueueLaserWorkflow,
  cleanupInactiveWorkflowStates,
  // SCANNER-FIX additions
  setWorkflowHooks,
  restoreWorkflowStates,
  getActiveWaitingPart,
  resetWorkflowStateUnlessWaitingForOtherPart,
  getCustomerQrWaitMs,
};
