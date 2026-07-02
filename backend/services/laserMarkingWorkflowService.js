const workflowStates = new Map();
const workflowQueues = new Map();
let queueSequence = 0;

const WORKFLOW_STATE_TTL_MS = Math.max(Number(process.env.LASER_WORKFLOW_STATE_TTL_MS || 60 * 60 * 1000), 5 * 60 * 1000);
const LASER_QUEUE_ITEM_TIMEOUT_MS = Math.max(Number(process.env.LASER_QUEUE_ITEM_TIMEOUT_MS || 20000), 5000);

const VALID_TRANSITIONS = {
  IDLE: new Set(["START_QR_RECEIVED", "WAITING_CUSTOMER_QR", "CUSTOMER_QR_ONLY_RECEIVED", "RESETTING"]),
  START_QR_RECEIVED: new Set(["WAITING_CUSTOMER_QR", "RESETTING"]),
  WAITING_CUSTOMER_QR: new Set(["CUSTOMER_QR_RECEIVED", "MAPPING", "RESETTING"]),
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
      lastUpdatedAt: Date.now(),
    });
  }
  return workflowStates.get(key);
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
  state.status = "IDLE";
  state.lastUpdatedAt = Date.now();
  return state;
}

function beginWorkflow(key, { machineId, stationNo, partId }) {
  const state = getWorkflowState(key);
  state.machineId = machineId || state.machineId;
  state.stationNo = stationNo || state.stationNo;
  state.activePartId = String(partId || "").trim();
  state.waitingForCustomerQr = Boolean(state.activePartId);
  state.lastStartQr = state.activePartId;
  state.lastCustomerQr = "";
  state.lastError = "";
  state.pendingCustomerQr = null;
  state.status = "IDLE";
  if (state.activePartId) {
    transitionWorkflowState(state, "START_QR_RECEIVED", { reason: "START_QR_RECEIVED" });
    transitionWorkflowState(state, "WAITING_CUSTOMER_QR", { reason: "WAITING_CUSTOMER_QR" });
  }
  state.lastUpdatedAt = Date.now();
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
  state.status = "READY";
  state.lastUpdatedAt = Date.now();
  return state;
}

function runWithTimeout(work, timeoutMs, item) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`Laser workflow queue item ${item.id} timed out after ${timeoutMs}ms`);
      error.code = "LASER_QUEUE_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([work(), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
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
        current.reject(error);
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
};
