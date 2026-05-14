# Industrial Traceability System - Issues & Fixes Quick Reference

## CRITICAL ISSUES (Must Fix)

### Issue #1: Race Condition in Machine Busy Lock
**Severity:** CRITICAL  
**Location:** `backend/services/plcHandshakeEngine.js` line 70-80  
**Current Code:**
```javascript
if (this.machineBusy.has(machineId)) {
  throw new Error("Machine busy");
}
this.machineBusy.add(machineId);  // ← Not atomic with DB check
```

**Problem:** Two scans can pass the `machineBusy.has()` check before either calls `.add()`

**Fix:**
```javascript
// Use database atomic lock instead of in-memory Set
const lockResult = await tryAcquireMachineLock({
  machineId,
  partId,
  stationNo,
});
if (!lockResult.acquired) {
  throw new Error(`Machine locked: ${lockResult.reason}`);
}
```

**Impact:** Prevents duplicate operations on same machine during rapid scans  
**Effort:** 2 hours  

---

### Issue #2: Stale Lock Recovery Requires Transaction
**Severity:** CRITICAL  
**Location:** `backend/services/machineLockService.js` line 40-85  
**Current Code:**
```javascript
// Query 1: Check if stale
const machine = await Machine.findByPk(id, {...});
const stale = Date.now() - new Date(machine.running_started_at) > DEFAULT_LOCK_STALE_MS;

// Query 2: If stale, clear it
if (stale) {
  await clearMachineLock(id);  // ← Another query
  
  // Query 3: Try to acquire
  const [recovered] = await Machine.update({...}, {where: {id, is_running: false}});
}
```

**Problem:** Between check and recovery, another process could release or acquire lock

**Fix:**
```javascript
const [updated] = await Machine.update(
  { is_running: true, running_part_id: runningPartId, ... },
  {
    where: {
      id,
      [Op.or]: [
        { is_running: false },
        sequelize.where(
          sequelize.fn('TIMESTAMPDIFF', sequelize.literal('MINUTE'), 
            sequelize.col('running_started_at'), sequelize.fn('NOW')),
          Op.gt,
          15  // minutes
        )
      ]
    }
  }
);
```

**Impact:** Ensures atomic stale lock recovery  
**Effort:** 1 hour  

---

### Issue #3: Health Check Interval Backlog
**Severity:** CRITICAL  
**Location:** `backend/services/plcHealthService.js` line 330-340  
**Current Code:**
```javascript
function startPlcHealthMonitor() {
  timerRef = setInterval(() => {
    runHealthCheckCycle();  // ← If this takes >15s, cycles queue
  }, HEARTBEAT_INTERVAL_MS);
}
```

**Problem:** If health check slow (many machines, network issues), setInterval calls queue

**Fix:**
```javascript
async function scheduleNextHealthCheck() {
  try {
    await runHealthCheckCycle();
  } catch (error) {
    console.error("Health check failed:", error.message);
  } finally {
    timerRef = setTimeout(scheduleNextHealthCheck, HEARTBEAT_INTERVAL_MS);
  }
}

function startPlcHealthMonitor() {
  if (timerRef) return;
  scheduleNextHealthCheck();
}
```

**Impact:** Prevents health check cycles from backing up  
**Effort:** 1 hour  

---

### Issue #4: Stale Intervals Without Cleanup
**Severity:** CRITICAL  
**Location:** 
- `backend/services/plcRetryQueue.js` line 119
- `backend/server.js` line 240

**Current Code:**
```javascript
// plcRetryQueue.js
setInterval(processQueue, PROCESS_INTERVAL_MS);  // ← No timer ref!

// server.js
setInterval(async () => {
  // Status emission
}, 5000);  // ← No cleanup on shutdown
```

**Problem:** On server restart or reload, timers accumulate in memory

**Fix:**
```javascript
// plcRetryQueue.js — expose refs for cleanup
const timerRefs = [];
const timerId = setInterval(processQueue, PROCESS_INTERVAL_MS);
timerRefs.push(timerId);

module.exports = {
  enqueue, processQueue, clearQueue, getQueueSnapshot,
  cleanup: () => timerRefs.forEach(clearInterval)
};

// server.js — cleanup on shutdown
const statusTimerId = setInterval(() => {...}, 5000);
process.on('SIGTERM', () => {
  clearInterval(statusTimerId);
  // other cleanup
});
```

**Impact:** Prevents timer leaks on restart  
**Effort:** 1.5 hours  

---

### Issue #5: Startup Recovery Truncation
**Severity:** CRITICAL  
**Location:** `backend/services/startupRecoveryService.js` line 13-18  
**Current Code:**
```javascript
const staleRows = await OperationLog.findAll({
  where: { plc_status: { [Op.in]: ["PENDING", "STARTED"] } },
  order: [["updatedAt", "ASC"]],
  limit: 500,  // ← Silent truncation!
});
```

**Problem:** If >500 stalled operations, only first 500 recovered. No warning.

**Fix:**
```javascript
const staleRows = await OperationLog.findAll({
  where: { plc_status: { [Op.in]: ["PENDING", "STARTED"] } },
  order: [["updatedAt", "ASC"]],
  // Remove limit or add logging:
});

if (staleRows.length > 500) {
  console.warn(
    `[STARTUP] ${staleRows.length} stale operations found. ` +
    `Processing first 500. Consider implementing batch recovery.`
  );
  staleRows = staleRows.slice(0, 500);
}
```

**Impact:** Prevents silent data loss during recovery  
**Effort:** 30 minutes  

---

## HIGH PRIORITY ISSUES

### Issue #6: No Operation-Level Transactions
**Severity:** HIGH  
**Location:** `backend/controllers/traceabilityController.js` lines 1100-1150  
**Current Code:**
```javascript
async function startPlcFlow(...) {
  // 1. Mark operation started (separate query)
  await markOperationStarted(operationLogId, machineId);
  
  // 2. Execute PLC handshake (network call)
  await plcHandshakeEngine.executeCycle({...});
  
  // 3. Mark operation ended (separate query)
  await markOperationEndedOk({...});
  
  // 4. Release lock (separate query)
  await clearMachineLock(machineId);
}
```

**Problem:** If crash between steps 1-4, DB inconsistent (operation STARTED but no result)

**Fix:**
```javascript
async function startPlcFlow(...) {
  const transaction = await sequelize.transaction();
  try {
    await markOperationStarted(operationLogId, machineId, { transaction });
    
    // PLC exec outside transaction (long operation)
    const result = await plcHandshakeEngine.executeCycle({...});
    
    // Final state update in new transaction
    const finalTx = await sequelize.transaction();
    try {
      if (result.ok) {
        await markOperationEndedOk({...}, { transaction: finalTx });
      } else {
        await markOperationCommunicationError({...}, { transaction: finalTx });
      }
      await clearMachineLock(machineId, { transaction: finalTx });
      await finalTx.commit();
    } catch (err) {
      await finalTx.rollback();
      throw err;
    }
  } catch (error) {
    // Rollback or handle gracefully
    throw error;
  }
}
```

**Impact:** Ensures operation state consistency  
**Effort:** 3 hours  

---

### Issue #7: No Max Concurrent Health Checks
**Severity:** HIGH  
**Location:** `backend/services/plcHealthService.js` line 240  
**Current Code:**
```javascript
async function runHealthCheckCycle() {
  if (inFlight) return;  // ← Only prevents parallel cycles
  inFlight = true;
  
  // Parallelize all machines at once:
  await Promise.all(
    machines.map(machine => probePlc({...}))  // ← Could be 100+ concurrent sockets
  );
}
```

**Problem:** With many machines, could spawn 100+ concurrent socket connections

**Fix:**
```javascript
const pLimit = require('p-limit');

async function runHealthCheckCycle() {
  if (inFlight) return;
  inFlight = true;
  
  const limit = pLimit(5);  // Max 5 concurrent probes
  await Promise.all(
    machines.map(machine => 
      limit(() => probePlc({...}))
    )
  );
  inFlight = false;
}
```

**Impact:** Prevents socket exhaustion during health checks  
**Effort:** 1.5 hours  

---

### Issue #8: Circuit Breaker Never Auto-Recovers
**Severity:** HIGH  
**Location:** `backend/services/plcCommunicationService.js` line 190-210  
**Current Code:**
```javascript
if (this.isCircuitOpen(circuitState)) {
  const error = new Error(
    `PLC circuit open until ${new Date(circuitState.openUntil).toISOString()}`
  );
  throw error;  // ← Stays open for 30s, then ANY success closes it
}
```

**Problem:** After 30s, first attempt reopens regardless of success. If transient + immediate failure, re-opens but only after 30s wait.

**Fix:**
```javascript
// Add exponential backoff when reopening
const CIRCUIT_BACKOFF_ATTEMPTS = 3;

if (this.isCircuitOpen(circuitState)) {
  // Calculate next reopen time with exponential backoff
  const backoffMs = Math.pow(2, Math.min(circuitState.reopenAttempts || 0, CIRCUIT_BACKOFF_ATTEMPTS)) * 1000;
  const nextReopenAt = circuitState.openUntil + backoffMs;
  
  if (Date.now() < nextReopenAt) {
    throw new Error(`PLC circuit open until ${new Date(nextReopenAt).toISOString()}`);
  }
  // Try to reopen
}
```

**Impact:** Prevents rapid reopen attempts during outages  
**Effort:** 1 hour  

---

### Issue #9: Socket Pool Leak Not Tracked
**Severity:** HIGH  
**Location:** `backend/services/plcProtocols/socketPool.js` line 115-125  
**Current Code:**
```javascript
function cleanupIdleSockets() {
  for (const [key, entry] of pool.entries()) {
    if (now - entry.lastUsedAt > DEFAULT_IDLE_MS) {
      try {
        entry.socket.destroy();  // ← Errors swallowed
      } catch (_error) {
        // noop
      }
      pool.delete(key);
    }
  }
}
```

**Problem:** Socket destroy errors not tracked. Can't diagnose socket leaks.

**Fix:**
```javascript
const metrics = { destroyed: 0, orphaned: 0, errors: 0 };

function cleanupIdleSockets() {
  for (const [key, entry] of pool.entries()) {
    if (now - entry.lastUsedAt > DEFAULT_IDLE_MS) {
      try {
        entry.socket.destroy();
        metrics.destroyed++;
      } catch (error) {
        metrics.orphaned++;
        metrics.errors++;
        console.warn(`[SocketPool] Cleanup error for ${key}: ${error.message}`);
      }
      pool.delete(key);
    }
  }
}

module.exports = {
  withSocket,
  getMetrics: () => ({...metrics})
};

// Expose via GET /api/diagnostics/socket-pool
```

**Impact:** Better visibility into socket leaks  
**Effort:** 1 hour  

---

### Issue #10: Frontend PASS/FAIL Heuristics
**Severity:** HIGH  
**Location:** `frontend/src/components/GlobalPopup.jsx` line 20-60  
**Current Code:**
```javascript
function resolveOperationState(popup = {}) {
  const status = String(popup.plcStatus || "").toUpperCase();
  
  if (["ENDED_OK", "PASSED", "COMPLETED"].includes(status)) 
    return "PASS";
  if (["ENDED_NG", "FAILED", "NG", "INTERLOCKED"].includes(status))
    return "FAIL";
  // ... more heuristics
}
```

**Problem:** Frontend duplicates backend logic. If backend adds new status, frontend breaks.

**Fix:** Server sends canonical decision:
```javascript
// Backend — traceabilityController.js
emitRealtime("operator_popup", {
  type: "SUCCESS",
  partId,
  stationNo,
  machineId: machine.id,
  status: "ENDED_OK",
  decision: "PASS",  // ← Explicit field
  message: "Operation Passed",
});

// Frontend — GlobalPopup.jsx
function resolveOperationState(popup = {}) {
  if (popup.decision === "PASS") return "PASS";
  if (popup.decision === "FAIL") return "FAIL";
  // Fallback for legacy events
  const status = String(popup.plcStatus || "").toUpperCase();
  // ... heuristics
}
```

**Impact:** Decouples frontend from backend status changes  
**Effort:** 2 hours  

---

## MEDIUM PRIORITY ISSUES

### Issue #11: Offline Buffer Lacks Metadata
**Severity:** MEDIUM  
**Location:** `backend/services/offlineBuffer.js` line 40-50  
**Current Code:**
```javascript
function bufferRecord(record) {
  const records = _readBuffer();
  records.push({ ...record, _bufferedAt: new Date().toISOString() });
  _writeBuffer(records);
}
```

**Problem:** On replay failure, no error info saved. Can't debug why replay failed.

**Fix:**
```javascript
function bufferRecord(record, { operation, context } = {}) {
  const records = _readBuffer();
  records.push({
    ...record,
    _bufferedAt: new Date().toISOString(),
    _operation: operation || "CREATE",
    _context: context || {},
    _retryCount: 0,
    _lastError: null
  });
  _writeBuffer(records);
}

async function replayBuffer(modelMap = {}) {
  const failed = [];
  
  for (const record of records) {
    try {
      const Model = modelMap[record._model];
      await Model.create(record);
      record._retryCount++;
    } catch (err) {
      record._lastError = err.message;
      record._retryCount++;
      
      if (record._retryCount > 3) {
        failed.push(record);
      }
    }
  }
  
  _writeBuffer(failed);
}
```

**Impact:** Better debugging of offline operations  
**Effort:** 2 hours  

---

### Issue #12: No Audit Trail for Failures
**Severity:** MEDIUM  
**Location:** `backend/models/OperationLog.js`  
**Current Schema:**
```javascript
plc_status: { type: DataTypes.ENUM(...), defaultValue: "PENDING" },
interlock_reason: DataTypes.STRING,  // ← Just text, no structure
```

**Problem:** Can't track failure history (what errors occurred, when, how resolved)

**Fix:**
```javascript
const OperationLog = sequelize.define("OperationLog", {
  // ... existing fields
  
  plc_status: { ... },
  interlock_reason: DataTypes.STRING,
  
  // NEW: Structured failure tracking
  failure_history: {  // JSON array
    type: DataTypes.JSON,
    defaultValue: [],
    comment: "[{ timestamp, errorCode, message, retryCount }]"
  },
  retry_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  error_code: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: "PLC_TIMEOUT, PLC_COMM_ERROR, INTERLOCKED, etc."
  }
});
```

**Then in traceabilityController:**
```javascript
async function markOperationCommunicationError({...}) {
  const opLog = await OperationLog.findByPk(operationLogId);
  const history = opLog.failure_history || [];
  history.push({
    timestamp: new Date().toISOString(),
    errorCode: reason?.split('_')[0] || "UNKNOWN",
    message: reason,
    retryCount: opLog.retry_count
  });
  
  await opLog.update({
    plc_status: "PLC_COMM_ERROR",
    interlock_reason: reason,
    retry_count: opLog.retry_count + 1,
    failure_history: history
  });
}
```

**Impact:** Full failure audit trail for SLA/diagnostics  
**Effort:** 3 hours  

---

### Issue #13: Socket Listener Dedup Not Implemented
**Severity:** MEDIUM  
**Location:** `frontend/src/pages/ComponentJourney.jsx` line 620-635  
**Current Code:**
```javascript
socket.on("scan_event", (p={}) => {
  patchPartFromRealtime(p);
  scheduleRealtimeRefresh();  // ← Calls timeout, could fire multiple times
});
```

**Problem:** Rapid scan events trigger multiple refreshes scheduled

**Fix:**
```javascript
let refreshTimer = null;
const REFRESH_DEBOUNCE_MS = 200;

const scheduleRealtimeRefresh = useCallback(() => {
  if (refreshTimer) clearTimeout(refreshTimer);
  
  refreshTimer = setTimeout(() => {
    refreshJourneyNow(false);
    refreshTimer = null;
  }, REFRESH_DEBOUNCE_MS);
}, [refreshJourneyNow]);

// Cleanup on unmount
useEffect(() => {
  return () => {
    if (refreshTimer) clearTimeout(refreshTimer);
  };
}, []);
```

**Impact:** Reduces unnecessary API calls, smoother UI  
**Effort:** 1 hour  

---

### Issue #14: No PLC Operation Timeout Per-Machine
**Severity:** MEDIUM  
**Location:** `backend/services/plcConnectionManager.js` line 50-60  
**Current Code:**
```javascript
const DEFAULT_OPERATION_TIMEOUT_MS = Math.max(
  Number(process.env.PLC_QUEUE_OPERATION_TIMEOUT_MS || 15000), 1000
);

async function runExclusive({ machineId, ip, port, ..., task }) {
  // Uses DEFAULT_OPERATION_TIMEOUT_MS for ALL machines
}
```

**Problem:** Slow machines share timeout with fast machines. Can't tune per-machine.

**Fix:**
```javascript
async function runExclusive({ 
  machineId, ip, port, operationName, task, 
  timeoutMs,  // ← Add parameter
  machine 
}) {
  const effectiveTimeout = timeoutMs || 
    (machine?.plc_operation_timeout_ms ? 
      Number(machine.plc_operation_timeout_ms) : 
      this.DEFAULT_OPERATION_TIMEOUT_MS);
  
  return this.withTimeout(
    Promise.resolve().then(task),
    effectiveTimeout,
    // ...
  );
}

// In traceabilityController:
await plcConnectionManager.runExclusive({
  machineId,
  ip, port,
  operationName,
  task,
  timeoutMs: machine.plc_operation_timeout_ms || 15000,  // ← Pass per-machine
  machine
});

// In Machine model:
plc_operation_timeout_ms: {
  type: DataTypes.INTEGER,
  allowNull: true,
  defaultValue: 15000,
  comment: "Operation timeout in ms. If null, uses global default."
}
```

**Impact:** Better tuning for heterogeneous PLC systems  
**Effort:** 2 hours  

---

## DUPLICATE CODE / REFACTORING CANDIDATES

### Candidate #1: Register Parsing
**Locations:** 
- traceabilityController.js line 550
- machineController.js line 100
- Both define identical `parseRegisterToken()` function

**Fix:** Extract to `backend/utils/registerParse.js`
```javascript
// backend/utils/registerParse.js
function parseRegisterToken(rawValue, fallbackDevice = null) {
  const text = String(rawValue ?? "").trim().toUpperCase();
  if (!text) return { register: null, device: fallbackDevice };
  
  const direct = Number(text);
  if (Number.isFinite(direct)) return { register: Math.trunc(direct), device: fallbackDevice };
  
  const match = text.match(/^([A-Z]+)?\s*(\d+)$/);
  if (!match) return { register: null, device: fallbackDevice };
  
  return {
    register: Math.trunc(Number(match[2])),
    device: String(match[1] || fallbackDevice || "").trim().toUpperCase() || fallbackDevice
  };
}
```

**Effort:** 1 hour  

---

### Candidate #2: Signal State Evaluation
**Locations:**
- traceabilityController.js line 600 (`evaluateSignalState()`)
- IoMonitor.jsx (frontend) has similar logic

**Fix:** Move to shared `backend/utils/signalEval.js`

**Effort:** 1.5 hours  

---

### Candidate #3: Status Normalization
**Locations:**
- plcHandshakeEngine.js line 10 (`MACHINE_STATES`)
- plcHealthService.js line 50 (`normalizeStation()`)
- traceabilityController.js line 200 (`normalizeStation()`)
- Multiple defines of `toUpper()`, `toInt()`, etc.

**Fix:** Create `backend/utils/normalize.js`
```javascript
module.exports = {
  normalizeStation: (value) => String(value || "").trim().toUpperCase(),
  toUpper: (value) => String(value || "").trim().toUpperCase(),
  toInt: (value) => {
    if (value === undefined || value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
};
```

**Effort:** 2 hours  

---

## STALE CODE / UNUSED FEATURES

### Unused Enum Values
**File:** backend/models/OperationLog.js
```javascript
plc_status: {
  type: DataTypes.ENUM(
    "PENDING", "STARTED", "ENDED_OK", "ENDED_NG", 
    "INTERLOCKED", 
    "PLC_COMM_ERROR", 
    "RESET",      // ← NEVER SET
    "RETRY"       // ← NEVER SET
  ),
}
```

**Action:** Remove or implement, add migration

---

### Unused Function
**File:** backend/services/plcSocketService.js
```javascript
module.exports = require("./plcCommunicationService");  // ← Just re-exports
```

**Action:** Remove, update imports to use plcCommunicationService directly

---

### Dead Code Path
**File:** backend/controllers/traceabilityController.js
```javascript
function parseRegisterToken(rawValue, fallbackDevice = null) {
  // ... 30 lines of duplicated logic
}

// Same function defined separately in machineController.js
```

**Action:** Consolidate to shared utils

---

## SUMMARY BY EFFORT

| Effort | Count | Examples |
|--------|-------|----------|
| < 1 hour | 4 | Unused enums, Stale intervals logging, Socket metrics, Issue #14 (machine timeout) |
| 1-2 hours | 9 | Race condition fixes, Health check backlog, Register parsing consolidation, Offline metadata |
| 2-3 hours | 5 | Transaction wrapper, Heuristics canonicalization, Audit trail, Socket dedup |
| 3-5 hours | 2 | Operation-level transactions, Startup recovery redesign |
| **Total** | **20** | **~35 hours of focused work** |

---

## RISK MITIGATION ROADMAP

**Phase 1: Stability** (Week 1)
- [ ] Fix machine busy race condition
- [ ] Add interval cleanup
- [ ] Fix health check backlog
- [ ] Add startup recovery consistency

**Phase 2: Resilience** (Week 2)
- [ ] Add operation transactions
- [ ] Implement socket metrics
- [ ] Canonicalize PASS/FAIL decisions
- [ ] Add per-machine timeouts

**Phase 3: Diagnostics** (Week 3)
- [ ] Add failure audit trail
- [ ] Enhance offline buffer
- [ ] Deduplicate register parsing
- [ ] Socket listener dedup

**Phase 4: Optimization** (Week 4)
- [ ] PLC socket pool tuning
- [ ] Circuit breaker backoff
- [ ] Query optimization
- [ ] Monitoring/dashboarding

---

**Document Status:** Complete  
**Last Updated:** May 8, 2026  
**Reviewer:** Required before implementation
