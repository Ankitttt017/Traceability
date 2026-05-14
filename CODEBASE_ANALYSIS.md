# Industrial Traceability System - Comprehensive Codebase Analysis
**Generated:** May 8, 2026 | **Analysis Scope:** Backend architecture, PLC communication, database models, recovery mechanisms, frontend listeners

---

## EXECUTIVE SUMMARY

This industrial traceability system manages part production workflows across networked machines with PLC integration. The system uses **Socket.IO for real-time updates**, **multi-protocol PLC communication** (TCP_TEXT/MODBUS_TCP/SLMP), and **in-memory state management** with database persistence. The architecture demonstrates sophisticated recovery mechanisms but has identified gaps in concurrent operation handling and potential memory leak patterns.

---

## 1. BACKEND ARCHITECTURE OVERVIEW

### 1.1 Services Layer (25 Total Services)

| Service | Purpose | Criticality |
|---------|---------|------------|
| **plcConnectionManager.js** | Queue-based exclusive operation runner per PLC endpoint | **CRITICAL** |
| **plcHandshakeEngine.js** | Machine state tracking and operation lifecycle | **CRITICAL** |
| **plcCommunicationService.js** | Protocol dispatch, circuit breaker, simulation mode | **CRITICAL** |
| **plcHealthService.js** | 15s interval heartbeat monitoring | **HIGH** |
| **startupRecoveryService.js** | Recovers PENDING/STARTED operations on restart | **HIGH** |
| **plcSocketService.js** | Wrapper re-export of plcCommunicationService | LOW |
| **plcRetryQueue.js** | Auto-processing retry queue for failed writes | HIGH |
| **offlineBuffer.js** | JSON file fallback when DB unavailable | MEDIUM |
| **machineBypassService.js** | In-memory machine bypass flag store | MEDIUM |
| **machineLockService.js** | Per-machine run lock with 15min stale timeout | **CRITICAL** |
| **scannerConnectionService.js** | Scanner connection lifecycle tracking | MEDIUM |
| **realtimeService.js** | Socket.IO broadcast dispatcher | **CRITICAL** |
| **stationFeatureService.js** | Station-level feature flag resolver | MEDIUM |
| **packingService.js** | Packing logic and session tracking | MEDIUM |
| **alarmService.js** | Alarm monitoring (NG rate, silent machine, PLC disconnect) | HIGH |
| **AuthService.js** | User authentication | HIGH |
| **industrialLogger.js** | Structured logging | LOW |
| **plcProtocols/** | Protocol implementations (tcpTextService, modbusService, slmpService) | **CRITICAL** |

---

## 2. PLC COMMUNICATION ARCHITECTURE

### 2.1 Connection Manager Pattern

**File:** `plcConnectionManager.js`

```
Operation Flow:
  Request → getOrInitEndpointStats() → withTimeout() → runExclusive()
                                              ↓
                                    endpointQueues[key].then(run)
                                              ↓
                                    Promise chain serialization
```

**Key Features:**
- Per-endpoint queue serialization (prevents concurrent operations on same IP:port)
- Operation timeout: 15s default (configurable via `PLC_QUEUE_OPERATION_TIMEOUT_MS`)
- Tracks: queued, running, completed, failed, timeouts, avg duration
- Stats snapshot available via `getQueueSnapshot()`

**⚠️ Issue: Timeout Timer Cleanup**
- `withTimeout()` uses `Promise.finally()` to clear setTimeout
- If promise settles before timeout, timer cleared properly
- **If timeout fires first and promise already rejected, may cause race condition**

### 2.2 Handshake Engine

**File:** `plcHandshakeEngine.js`

**Machine States:**
```
IDLE → SCANNED → VALIDATED → START_SENT → WAITING_RUNNING → RUNNING 
                                                                   ↓
                                        COMPLETED_OK / COMPLETED_NG / TIMEOUT / PLC_ERROR
```

**Key Features:**
- `machineBusy` Set prevents concurrent operations on same machine
- State transitions emitted via Socket.IO as `machine_state` events
- Operation callbacks: `onAckStart`, `onAckEndOk`, `onAckEndNg`, `onError`

**⚠️ Issue: Race Condition in executeCycle()**
```javascript
this.machineBusy.add(machineId);  // ← Add to set
setState(VALIDATED);               // ← Async event emit
try {
  await plcConnectionManager.runExclusive({...});
  // Long operation
  setState(IDLE);
} finally {
  this.machineBusy.delete(machineId);  // ← May be slow if machineBusy is large
}
```
- If second scan arrives BEFORE machineBusy.has() check completes, both could proceed
- **Recommend: Use database row-level lock via `is_running` flag atomically**

### 2.3 PLC Communication Service

**File:** `plcCommunicationService.js`

**Circuit Breaker Pattern:**
- Tracks consecutive failures per endpoint/machine
- Opens circuit after 5 failures (configurable: `PLC_CIRCUIT_FAILURE_THRESHOLD`)
- Stays open for 30s (configurable: `PLC_CIRCUIT_OPEN_MS`)
- Emits `plc_circuit_event` on state changes

**Protocol Dispatch:**
- TCP_TEXT (default)
- MODBUS_TCP
- SLMP

**Simulation Mode:** Configurable via:
- `PLC_SIMULATION_MODE=true` (env)
- Per-machine `plc_simulation_mode` flag
- Returns simulated ACK with delays: `PLC_SIM_START_DELAY_MS`, `PLC_SIM_END_DELAY_MS`

**Retry Strategy:**
- Up to 3 retries per handshake (configurable: `PLC_RETRY_COUNT`)
- 250ms delay between retries
- Circuit opens if threshold exceeded

### 2.4 Socket Management

**File:** `plcProtocols/socketPool.js`

**Pool Behavior:**
```
Enabled via: PLC_SOCKET_POOL_ENABLED=true
├─ acquireSocket() → reuses non-inUse socket OR creates new
├─ releaseSocket() → marks socket inUse=false, lastUsedAt=now()
└─ cleanupIdleSockets() → runs every (DEFAULT_IDLE_MS/2) ≈ 5s
                          destroys sockets idle > 10s
```

**⚠️ Issue: Potential Socket Leak**
- Cleanup interval runs every 5s, but if socket pool is large, cleanup could lag
- `socket.destroy()` wrapped in try-catch but errors not logged
- **Recommend: Add metric tracking for destroyed vs. orphaned sockets**

### 2.5 Health Monitoring

**File:** `plcHealthService.js`

**Behavior:**
```
Every 15s interval (HEARTBEAT_INTERVAL_MS):
├─ For each active machine:
│  ├─ If MODBUS_TCP: probeModbusHeartbeat()
│  └─ If TCP_TEXT: probePlc()
├─ Track heartbeat staleness:
│  └─ If register not changed > HEARTBEAT_STALE_MS (30s): mark unhealthy
└─ Emit plc_health events only on state change
```

**⚠️ Issue: setInterval Without Cleanup**
```javascript
if (timerRef) {
  return;  // Guard prevents restart but...
}
timerRef = setInterval(() => {
  runHealthCheckCycle();  // Could get slow if many machines
}, HEARTBEAT_INTERVAL_MS);
```
- No max concurrency guard: If health check takes > 15s, cycles will backlog
- `inFlight` flag prevents parallel checks but doesn't queue
- **Recommend: Use setTimeout chain instead of setInterval OR add concurrency limit**

---

## 3. RECOVERY & RESILIENCE

### 3.1 Startup Recovery Service

**File:** `startupRecoveryService.js`

**Execution Order** (called in `server.js` startServer()):
```javascript
1. sequelize.sync({ alter: syncAlter, force: syncForce })
2. ensureMachineQrScannerUniqueness()
3. resetAllMachineLocks()  ← Clears all is_running=true
4. resetAllScannerConnectionStates()
5. runStartupRecovery()  ← Our focus
6. ensureDefaultAdminUser()
7. ensureDefaultShifts()
```

**Recovery Flow:**
```javascript
recoverInFlightOperations():
  ├─ Find all OperationLog where plc_status IN ("PENDING", "STARTED")
  ├─ Limit 500 rows
  ├─ For each: update plc_status="PLC_COMM_ERROR", interlock_reason="RECOVERY_PENDING_AFTER_BACKEND_RESTART"
  └─ Emit operator_popup warnings

rebuildMachineRuntimeStates():
  ├─ Load all active machines
  └─ For each: clearMachineLock(machineId), setState(IDLE)
```

**⚠️ Issue: Race Condition Between 3 and 5**
```
resetAllMachineLocks() → UPDATE is_running=false WHERE is_running=true
  ↓ (concurrent)
runStartupRecovery() → SELECT * WHERE plc_status IN ("PENDING", "STARTED")
```
- If a slow query, operations may be recovered that should still be running
- **No row-level consistency guarantee**
- Recommend: Add transaction with row locks

**⚠️ Issue: 500-Row Limit**
- If system has > 500 stalled operations, only first 500 recovered
- Silent failure—no log warning about truncation
- **Recommend: Remove limit OR log when truncated**

### 3.2 Machine Lock Service

**File:** `machineLockService.js`

**Stale Timeout:** 15 minutes (default, configurable: `MACHINE_RUN_LOCK_STALE_MS`)

**Lock Acquisition:**
```javascript
tryAcquireMachineLock():
  ├─ UPDATE Machine SET is_running=true WHERE id=? AND is_running=false
  ├─ If rows affected > 0: acquired=true
  └─ Else:
      ├─ Check existing lock age
      ├─ If > 15min stale: clearMachineLock() then retry
      └─ Else: acquired=false (machine_running)
```

**⚠️ Issue: Stale Lock Recovery Logic**
- Atomicity: Two separate DB queries
- Between check and retry, lock could be released by another process
- **Better: Use single UPDATE with CASE statement**

```sql
-- Current (two queries):
SELECT is_running, running_started_at FROM Machine WHERE id=?
UPDATE Machine SET is_running=true WHERE id=? AND is_running=false

-- Recommended:
UPDATE Machine SET is_running=true 
WHERE id=? AND (is_running=false OR TIMESTAMPDIFF(...) > ?)
```

### 3.3 Offline Buffer (Database Fallback)

**File:** `offlineBuffer.js`

**Mechanism:**
- If DB write fails, record buffered to `backend/data/offline_buffer.json`
- On reconnect, replay all buffered records via `replayBuffer(modelMap)`
- Failed replays stay in buffer for retry

**⚠️ Issues:**
1. **No error recovery metadata:** Which write operation failed? Why?
2. **Manual model registration required:** `replayBuffer({ ProductionLog: ... })`
3. **File system reliability:** JSON file could corrupt if process crashes mid-write
4. **Recommend:** Add write-ahead log (WAL) or use SQLite fallback

---

## 4. DATABASE MODELS & OPERATION LIFECYCLE

### 4.1 Key Tables

| Model | Purpose | State Tracking |
|-------|---------|---|
| **OperationLog** | Per-part-per-station record | plc_status: PENDING/STARTED/ENDED_OK/ENDED_NG/INTERLOCKED/PLC_COMM_ERROR |
| **ProductionLog** | OK/NG summary | status: OK/NG |
| **ReworkLog** | Part rework tracking | reason text |
| **Machine** | Machine configuration | is_running (bool), running_part_id, running_station_no, running_started_at |
| **Part** | Part master data | current_station, status (IN_PROGRESS/COMPLETED/NG), is_interlocked |

### 4.2 Operation Timeline

```
Scan QR → Validate → tryAcquireMachineLock() → CREATE OperationLog(PENDING)
                              ↓
                    startPlcFlow() chains:
                        ├─ executeCycle()
                        ├─ onStarted() → markOperationStarted(STARTED)
                        ├─ [PLC running...]
                        ├─ onEndedOk() → markOperationEndedOk(ENDED_OK) → CREATE ProductionLog(OK)
                        ├─ onEndedNg() → markOperationEndedNg(ENDED_NG) → CREATE ProductionLog(NG)
                        └─ onError() → markOperationCommunicationError(PLC_COMM_ERROR)
                              ↓
                    clearMachineLock(machineId) → UPDATE Machine(is_running=false)
```

**⚠️ Issue: No Transactional Atomicity**
- OperationLog creation
- Machine lock acquisition
- PLC flow execution
- ProductionLog creation
- Machine lock release

All happen in separate calls without transaction scope. If process crashes between steps, DB is inconsistent.

### 4.3 Failure Tracking

Currently:
- `OperationLog.interlock_reason` = text (e.g., "PLC_COMM_ERROR", "RECOVERY_PENDING_AFTER_BACKEND_RESTART")
- `OperationLog.plc_status` = enum status
- No structured failure metadata (error code, timestamp, context)

**Gaps:**
- No automatic retry mechanism for transient failures
- No SLA/timeout configuration per machine
- No audit trail of failure resolution

---

## 5. FRONTEND ANALYSIS

### 5.1 Socket.IO Listeners Identified

**File:** `frontend/src/pages/ComponentJourney.jsx`

```javascript
socket.on("journey_update", (p={}) => {
  patchPartFromRealtime(p);
  processQrSignal(p);
  if (partMatch) scheduleRealtimeRefresh();
});

socket.on("scan_event", (p={}) => {
  patchPartFromRealtime(p);
  processQrSignal(p);
  if (partMatch) scheduleRealtimeRefresh();
});

socket.on("operator_popup", (p={}) => {
  patchPartFromRealtime(p);
  if (differentPart) return;
  scheduleRealtimeRefresh();
});

socket.on("dashboard_refresh", () => scheduleRealtimeRefresh());
```

### 5.2 Timer/Interval Management

**Identified Intervals:**

| Component | Interval | Cleanup |
|-----------|----------|---------|
| ComponentJourney fallback poll | 5s | ✅ useEffect cleanup |
| ComponentJourney catalog sync | ? | ✅ useEffect cleanup |
| GlobalPopup auto-close timeout | 2.5s | ✅ useEffect cleanup |
| Header shortcut timeout | 0ms | ✅ useEffect cleanup |
| plcHealthService monitor | 15s | ✅ stopPlcHealthMonitor() |
| alarmService monitor | Varies | ✅ Manually stopped? |
| plcRetryQueue processor | 5s | ❌ **No cleanup** |
| server.js status emitter | 5s | ❌ **No cleanup** |
| socketPool cleanup | 5s | ✅ interval.unref() |

**⚠️ Issue: Stale Intervals in Backend**

```javascript
// plcRetryQueue.js — line 119
setInterval(processQueue, PROCESS_INTERVAL_MS);  // ← No timer ref returned!

// server.js — line ~240
setInterval(async () => {  // ← No cleanup on shutdown
  // machine_status/scanner_status emission
}, 5000);
```

**Impact:** On server restart or module reload, timers accumulate without cleanup.

### 5.3 Frontend State Management

**Pattern:** ComponentJourney manages:
- `selectedPartId` (ref)
- `journeyData` (state)
- `qrFeed` (array)
- `qrByStation` (map)
- `resetConfirm` (popup state)

**⚠️ Issue: Realtime Patching Without Dedup**
```javascript
socket.on("scan_event", (p={}) => {
  patchPartFromRealtime(p);  // ← Patches state directly
  processQrSignal(p);         // ← Processes as QR event
  scheduleRealtimeRefresh();  // ← Also schedules API fetch
});
```
- If rapid scan events arrive, `scheduleRealtimeRefresh()` called multiple times
- Timeout is 500ms, so events could coalesce into single fetch
- **But:** Local state patch + API fetch = potential race condition if API returns stale data

### 5.4 GlobalPopup Component

**File:** `frontend/src/components/GlobalPopup.jsx`

**Logic:** Resolves popup state based on:
- `plcStatus` (ENDED_OK, ENDED_NG, INTERLOCKED, PLC_COMM_ERROR, etc.)
- `qrResult` (PASS, FAIL)
- `reason` (DUPLICATE_SCAN, MACHINE_RUNNING, etc.)

**Functions:**
- `resolveQrState()` → PASS/FAIL/WAIT
- `resolveOperationState()` → PASS/FAIL/RUN/WAIT/COMM
- `resolveRejectionState()` → PASS/FAIL/PENDING

**⚠️ Issue: Client-Side PASS/FAIL Heuristics**
```javascript
function resolveOperationState(popup = {}) {
  if (["ENDED_OK", "PASSED", "COMPLETED", "COMPLETED_OK"].includes(status)) 
    return "PASS";
  if (["ENDED_NG", "COMPLETED_NG", "FAILED", "NG", "INTERLOCKED"].includes(status))
    return "FAIL";
```

**Problem:** Frontend duplicates backend decision logic. If backend changes, frontend breaks.

**Recommendation:** Server should emit canonical `decision: "PASS"|"FAIL"|"PENDING"` in popup event.

### 5.5 No Frontend Local PASS/FAIL Logic Detected

✅ **Good:** Frontend does NOT independently decide PASS/FAIL.
- Decisions come from backend OperationLog
- Frontend only resolves display state

❌ **But:** Heuristics make frontend fragile to backend changes.

---

## 6. IDENTIFIED ISSUES & GAPS

### 6.1 Socket Management Gaps

| Issue | Severity | Location | Fix |
|-------|----------|----------|-----|
| Potential socket leak in cleanup | HIGH | plcProtocols/socketPool.js | Add orphaned socket tracking metric |
| No max concurrent health checks | HIGH | plcHealthService.js | Add concurrency limiter or setTimeout chain |
| Stale interval references | MEDIUM | plcRetryQueue.js, server.js | Return timer refs, store for cleanup |
| No socket pool stats endpoint | MEDIUM | plcConnectionManager.js | Export metrics via GET /api/diagnostics |

### 6.2 Reconnect/Recovery Gaps

| Issue | Severity | Location | Fix |
|-------|----------|----------|-----|
| No max retry limit per operation | HIGH | plcCommunicationService.js | Add per-operation retry counter |
| Circuit breaker opens indefinitely if PLC never recovers | HIGH | plcCommunicationService.js | Add exponential backoff to reopen attempt |
| Offline buffer has no replay failure alerting | MEDIUM | offlineBuffer.js | Emit alarm on replay failures |
| Startup recovery silently truncates at 500 rows | MEDIUM | startupRecoveryService.js | Log truncation or remove limit |

### 6.3 Race Conditions

| Issue | Severity | Scenario | Fix |
|-------|----------|----------|-----|
| executeCycle() + rapid scans | HIGH | Back-to-back QR scans on same machine | Use atomic DB lock instead of in-memory Set |
| Stale lock recovery (3 queries) | HIGH | Process crash between lock check & retry | Single atomic UPDATE with CASE |
| Health check + state read | MEDIUM | Machine state changes mid-health-check | Use DB transaction isolation |

### 6.4 Data Consistency Gaps

| Gap | Impact | Location |
|-----|--------|----------|
| No operation-level transactions | Partial failures leave DB inconsistent | traceabilityController.js |
| Machine lock vs OperationLog mismatch | Machine marked unlocked but operation stuck PENDING | startupRecoveryService.js |
| No audit trail for failure resolution | Can't trace why operation failed or recovered | OperationLog model |

### 6.5 Memory Leak Patterns

| Pattern | Risk | Location |
|---------|------|----------|
| Stale Socket.IO listeners | If listeners not unsubscribed properly | server.js io.on("connection") |
| setInterval without cleanup | Timer backlog on reload | plcHealthService, plcRetryQueue |
| Map unbounded growth | If machines added but entries never deleted | plcHealthService.healthStateMap |
| circuitStateMap persistence | If circuits never reset after recovery | plcCommunicationService.circuitStateMap |

**Mitigation:** Most Maps clean on server restart, but in production with hot reloads, could accumulate.

---

## 7. SERVICES SUMMARY TABLE

### 7.1 All 25 Backend Services

```
1.  alarmService.js                   — Alarm monitoring (NG rate, silent, disconnect)
2.  AuthService.js                    — JWT token management
3.  industrialLogger.js               — Structured logging
4.  machineBypassService.js           — In-memory bypass flags
5.  machineLockService.js             — Per-machine exclusive run lock
6.  machineSchemaService.js           — Machine config validation
7.  offlineBuffer.js                  — JSON fallback when DB down
8.  packingManagementService.js       — Packing session tracking
9.  packingService.js                 — Packing operations
10. plcCommandService.js              — PLC command execution
11. plcCommunicationService.js        — Protocol dispatch + circuit breaker
12. plcConnectionManager.js           — Queue-based operation serialization
13. plcHandshakeEngine.js             — Machine state + operation lifecycle
14. plcHealthService.js               — 15s heartbeat monitor
15. plcIoService.js                   — Register read/write (Modbus, SLMP)
16. plcProtocols/tcpTextService.js   — TCP text protocol impl
17. plcProtocols/modbusService.js    — Modbus TCP impl
18. plcProtocols/slmpService.js      — Mitsubishi SLMP impl
19. plcProtocols/socketPool.js       — Socket pooling + idle cleanup
20. plcRetryQueue.js                  — Auto-retry failed PLC writes
21. plcSocketService.js               — Wrapper (re-export of 11)
22. realtimeService.js                — Socket.IO broadcast dispatcher
23. scannerConnectionManager.js       — Scanner connection lifecycle
24. scannerConnectionService.js       — Scanner connection DB tracking
25. scannerHealthService.js           — Scanner heartbeat monitoring
26. scanService.js                    — QR scan processing
27. stationFeatureService.js          — Station config resolver
28. UserService.js                    — User profile management
```

---

## 8. CONTROLLERS SUMMARY

| Controller | Endpoints | State Mutation |
|------------|-----------|---|
| **traceabilityController.js** | processQrScan(), startOperation(), resetOperation(), getJourney() | OperationLog, Part, ProductionLog, Machine lock |
| **machineController.js** | listMachines(), updateMachine(), testPLC(), getIoSnapshot() | Machine, PlcRegisterRange |
| **scannerController.js** | listScanners(), updateScanner(), getConnectionStatus() | Scanner, ScannerConnection |
| **authController.js** | login(), validateToken() | User (read-only) |
| **userController.js** | getUser(), updateUser() | User |
| **alarmController.js** | listAlarms(), resolveAlarm() | Alarm |
| **auditController.js** | getAuditLog() | AuditLog (read-only) |

**Largest:** `traceabilityController.js` — Handles entire operation workflow

---

## 9. FRONTEND COMPONENT TREE

```
App.jsx
├─ NotificationProvider
├─ useAlarmToasts() ← Global Socket.IO listener
└─ Router
   ├─ LoginPage
   ├─ Dashboard ← 5s status refresh
   ├─ OperatorView ← Real-time socket listeners
   ├─ StationControls ← Manual operation controls
   ├─ IoMonitor ← PLC register read/write UI
   ├─ Traceability ← Part history view
   ├─ ComponentJourney ← Heavy Socket.IO listener (journey_update, scan_event, operator_popup)
   ├─ ProductionCharts ← Historical analytics
   ├─ Packing ← Packing workflow
   ├─ Scanners ← Scanner config
   ├─ PlcConfiguration ← PLC register mapping
   ├─ MasterSettingsDashboard ← Admin settings
   └─ ReportConfiguration ← Report builder
```

**Heavy listeners:** ComponentJourney, OperatorView, StationControls

---

## 10. RECOMMENDATIONS PRIORITIZED

### CRITICAL (Fix Immediately)

1. **Atomize Lock Acquisition** — Machine lock + operation creation should be single transaction
   - **File:** machineLockService.js, traceabilityController.js
   - **Fix:** Add DB transaction wrapper
   
2. **Remove In-Memory Machine Busy Set** — Use atomic `is_running` flag in DB only
   - **File:** plcHandshakeEngine.js
   - **Impact:** Eliminates race condition from concurrent fast scans

3. **Add Interval Cleanup at Startup** — Store timer refs for graceful shutdown
   - **Files:** server.js, plcRetryQueue.js
   - **Fix:** Return interval ID, call clearInterval on sigterm

4. **Prevent Health Check Backlog** — Convert setInterval to setTimeout chain
   - **File:** plcHealthService.js
   - **Impact:** Prevents 15s cycles from queuing if health check slow

### HIGH PRIORITY (Fix Within Sprint)

5. **Circuit Breaker Exponential Backoff** — Auto-recover instead of manual reset
   - **File:** plcCommunicationService.js
   - **Config:** Add `PLC_CIRCUIT_BACKOFF_STRATEGY` env

6. **Startup Recovery Consistency** — Use transaction with row locks
   - **File:** startupRecoveryService.js
   - **Fix:** Wrap recoverInFlightOperations in sequelize transaction

7. **Socket Pool Metrics** — Track orphaned/destroyed socket counts
   - **File:** plcProtocols/socketPool.js
   - **Expose:** GET /api/diagnostics/socket-pool

8. **Frontend PASS/FAIL Canonicalization** — Server sends `decision` field
   - **Files:** traceabilityController.js, GlobalPopup.jsx
   - **Impact:** Decouples frontend UI from backend logic changes

### MEDIUM PRIORITY (Improve Robustness)

9. **Offline Buffer WAL** — Replace JSON file with SQLite or journaling
   - **File:** offlineBuffer.js
   - **Benefit:** Better crash safety

10. **Operation-Level Transactions** — Wrap entire operation flow
    - **Files:** traceabilityController.js, models
    - **Benefit:** Ensures atomicity of OperationLog + ProductionLog + Machine lock

11. **Structured Failure Metadata** — Add error codes, retry count, context to OperationLog
    - **File:** OperationLog model, traceabilityController.js
    - **Benefit:** Better diagnostics and SLA tracking

12. **Socket Listener Dedup** — Coalesce rapid scan_event socket messages
    - **File:** ComponentJourney.jsx
    - **Config:** Add debounce duration constant

---

## 11. ENVIRONMENT VARIABLES CONTROLLING BEHAVIOR

```bash
# PLC Connection
PLC_QUEUE_OPERATION_TIMEOUT_MS=15000         # Operation timeout
PLC_CONNECT_TIMEOUT_MS=2000                  # Socket connect timeout
PLC_RETRY_COUNT=3                            # Handshake retries
PLC_CIRCUIT_FAILURE_THRESHOLD=5              # Failures to open circuit
PLC_CIRCUIT_OPEN_MS=30000                    # Time circuit stays open

# Health Monitoring
PLC_HEARTBEAT_INTERVAL_MS=15000              # Health check interval
PLC_HEARTBEAT_TIMEOUT_MS=3000                # Heartbeat probe timeout
PLC_HEARTBEAT_STALE_MS=30000                 # Time to mark heartbeat stale

# Socket Pooling
PLC_SOCKET_POOL_ENABLED=true                 # Enable socket reuse
PLC_SOCKET_IDLE_MS=10000                     # Idle timeout before destroy

# Simulation
PLC_SIMULATION_MODE=false                    # Simulate all PLCs
PLC_SIMULATION_RESULT=OK                     # Simulated result (OK/NG)
PLC_SIM_START_DELAY_MS=150                   # Sim start delay
PLC_SIM_END_DELAY_MS=600                     # Sim end delay

# Machine Locking
MACHINE_RUN_LOCK_STALE_MS=900000             # 15 min stale lock timeout

# Database
DB_SYNC_ALTER=false                          # Auto-alter schema
DB_SYNC_FORCE=false                          # Force sync (destructive)
DB_SETUP_MODE=false                          # Skip permission errors

# Alarms
ALARM_NG_RATE_THRESHOLD=0.1                  # 10% NG rate alarm
ALARM_SILENT_WINDOW_MS=600000                # 10 min silent alarm window
ALARM_SILENT_REQUIRE_PREVIOUS_LOG=true       # Require prior log for silent alarm
```

---

## 12. DATABASE SCHEMA ISSUES

### OperationLog Enum Gap
```sql
plc_status ENUM('PENDING', 'STARTED', 'ENDED_OK', 'ENDED_NG', 'INTERLOCKED', 'PLC_COMM_ERROR', 'RESET', 'RETRY')
```

**Problem:**
- RESET and RETRY enums exist but never used in code
- INTERLOCKED conflates with ENDED_NG (should be separate reason)
- No ABORTED, TIMEOUT_WAITING_START enums

**Recommendation:** Add:
```sql
ALTER TABLE OperationLogs ADD COLUMN plc_status_detail VARCHAR(200) NULL;
ALTER TABLE OperationLogs ADD COLUMN retry_count INT DEFAULT 0;
ALTER TABLE OperationLogs ADD COLUMN last_error_code VARCHAR(50) NULL;
```

### Missing Indices
- OperationLog.plc_status (for recovery queries)
- OperationLog.machine_id + plc_status (for dashboard queries)
- Machine.is_running (for lock validation queries)

---

## 13. CONCLUSION

**Strengths:**
- ✅ Solid multi-protocol PLC communication foundation
- ✅ Circuit breaker pattern prevents cascading failures
- ✅ Socket pooling reduces connection overhead
- ✅ Comprehensive recovery on startup
- ✅ Real-time Socket.IO updates for operator feedback

**Weaknesses:**
- ❌ Race conditions in concurrent operation handling
- ❌ In-memory state not atomic with DB state
- ❌ Stale intervals accumulate over time
- ❌ Limited failure metadata for diagnostics
- ❌ Frontend duplicates backend PASS/FAIL logic

**Overall Assessment:** **PRODUCTION-READY with provisos** — System handles nominal flows well. However, under high concurrency (rapid scans, network failures, process crashes) has failure modes. Recommend implementing CRITICAL fixes before production deployment.

**Estimated Fix Time:** 3-5 days for all recommendations + testing
