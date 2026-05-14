# Frontend Cleanup Guide - Industrial Traceability System

## OVERVIEW

The frontend must be refactored to **ONLY render backend state** without any local decision-making, heuristics, or duplicate PLC logic.

**Golden Rule:** Frontend is a VIEW LAYER ONLY. All business logic must reside in backend.

---

## 1. CRITICAL ISSUES TO FIX

### 1.1 Frontend PASS/FAIL Decision Logic
**DANGER:** Frontend must NEVER decide PASS/FAIL

**Issues:**
- [ ] Machine.jsx - Check for local PASS/FAIL logic based on PLC signals
- [ ] OperatorView.jsx - Check for COMPLETED_OK/COMPLETED_NG assignments
- [ ] Any localStorage-based operation status
- [ ] Any frontend-calculated production log entries

**Fix:**
```javascript
// WRONG - Frontend deciding PASS/FAIL
if (plcState.endOk === true) {
  recordProductionLog({ result: 'PASS' }); // ❌ Frontend shouldn't decide!
}

// CORRECT - Only render what backend says
render() {
  const result = this.props.operationResult; // From backend only
  return <ResultDisplay result={result} />;
}
```

---

### 1.2 Duplicate WebSocket Listeners
**DANGER:** Multiple listeners on same event causes duplicate processing

**Files to audit:**
- [ ] GlobalPopup.jsx - Count all `socket.on()` calls
- [ ] Machine.jsx - Check for duplicate listeners
- [ ] OperatorView.jsx - Check event subscription
- [ ] StationControls.jsx - Check for scanner events
- [ ] IoMonitor.jsx - Check for PLC signal listeners

**Expected issue:**
```javascript
// ComponentDidMount
socket.on('machine_state', handleMachineStateUpdate);
socket.on('machine_state', handleMachineStateRedraw);  // ❌ Duplicate!
socket.on('machine_state', updateLocalState);          // ❌ Triplicate!
```

**Fix:**
```javascript
// Consolidate to single listener
socket.off('machine_state'); // Clear old
socket.on('machine_state', (state) => {
  handleMachineStateUpdate(state);
  updateDisplay(state);
  updateCache(state);
  // All logic in ONE listener
});
```

---

### 1.3 Stale Intervals Not Cleaned Up
**DANGER:** Memory leak - intervals accumulate on component unmount

**Files to audit:**
- [ ] Machine.jsx - setInterval for polling
- [ ] OperatorView.jsx - setInterval for status updates
- [ ] IoMonitor.jsx - setInterval for register polling
- [ ] StationControls.jsx - setInterval for machine status
- [ ] Any component using `setInterval` without cleanup

**Expected issue:**
```javascript
componentDidMount() {
  this.interval = setInterval(() => {
    this.fetchMachineState(); // Polls every 5s
  }, 5000);
}

componentWillUnmount() {
  // ❌ Forgot to clear interval!
}
```

**Fix:**
```javascript
componentDidMount() {
  this.interval = setInterval(() => {
    this.fetchMachineState();
  }, 5000);
}

componentWillUnmount() {
  if (this.interval) clearInterval(this.interval);
}
```

---

### 1.4 Stale Component State (State Drift)
**DANGER:** Component state diverges from backend state

**Files to audit:**
- [ ] Machine.jsx - Local `this.state.currentOperation`
- [ ] OperatorView.jsx - Local operation tracking
- [ ] StationControls.jsx - Local machine status cache
- [ ] Any component maintaining duplicate copies of backend data

**Expected issue:**
```javascript
// Component state
this.state = {
  machineState: 'IDLE',
  operationId: null,
  resultPass: false, // ❌ Local state, not from backend!
};

// Backend sends update
socket.on('machine_state', (backendState) => {
  // Old code tries to sync but logic is complex
  if (backendState.state === 'COMPLETED_OK') {
    this.setState({ resultPass: true });
  }
  // What if backend state arrives out of order?
});
```

**Fix:**
```javascript
// Component state should ONLY mirror backend
this.state = {
  backendMachineState: null, // Direct from backend
};

socket.on('machine_state', (state) => {
  this.setState({ backendMachineState: state });
  // No interpretation, no decisions
});

render() {
  const { state } = this.state.backendMachineState;
  return <Display state={state} />;
}
```

---

### 1.5 Duplicate Backend Polling
**DANGER:** Frontend polls same data multiple times

**Issues to find:**
- [ ] Machine.jsx polls machine status AND IoMonitor polls registers
- [ ] Multiple components each polling PLC state
- [ ] Polling intervals not coordinated

**Current pattern (WRONG):**
```javascript
// Machine.jsx
setInterval(() => {
  fetch('/api/v1/machines/1').then(m => this.setState({machine: m}));
}, 2000);

// IoMonitor.jsx
setInterval(() => {
  fetch('/api/v1/machines/1/registers').then(r => this.setState({registers: r}));
}, 2000);

// StationControls.jsx
setInterval(() => {
  fetch('/api/v1/machines/1/status').then(s => this.setState({status: s}));
}, 2000);

// ❌ Same machine, 3 separate API calls every 2s!
```

**Fix:**
```javascript
// Backend should emit aggregated state via Socket.IO
// Frontend listens once
socket.on('machine_status_aggregate', (data) => {
  // data = { machineId, state, registers, status }
  this.setState({
    machine: data.state,
    registers: data.registers,
    status: data.status,
  });
});
```

---

## 2. REQUIRED FRONTEND STATE MODEL

Frontend MUST ONLY consume these backend-provided properties:

```javascript
// Machine State (from backend, NO LOCAL DECISIONS)
{
  machineId: 1,
  state: 'RUNNING', // IDLE | SCANNED | VALIDATED | RUNNING | COMPLETED_OK | COMPLETED_NG | TIMEOUT | ERROR
  partId: 'PART-123',
  stationNo: 'STATION-1',
  result: 'PASS', // ← Backend decides, never frontend
  cycleStartTime: '2026-05-08T10:30:00Z',
  cycleEndTime: '2026-05-08T10:35:00Z',
  error: null, // If error, backend sets
  lastUpdate: '2026-05-08T10:34:59Z',
}

// PLC Health (from backend)
{
  endpoint: '192.168.1.100:502',
  connected: true,
  lastHeartbeat: '2026-05-08T10:34:58Z',
  responseTimeMs: 45,
  errorCount: 0,
}

// Queue Status (from backend)
{
  queuedOperations: 2,
  inFlightOperations: 1,
  avgLatencyMs: 120,
  maxQueueSize: 100,
}

// Scanner Health (from backend)
{
  scannerId: 1,
  connected: true,
  lastHeartbeat: '2026-05-08T10:34:59Z',
  totalScans: 15000,
}

// Operation Timeline (from backend) 
{
  operationId: 12345,
  events: [
    { eventType: 'SCANNED', timestamp: '10:30:00Z', duration: 0 },
    { eventType: 'VALIDATED', timestamp: '10:30:05Z', duration: 5 },
    { eventType: 'START_SENT', timestamp: '10:30:07Z', duration: 2 },
    { eventType: 'RUNNING', timestamp: '10:30:09Z', duration: 2 },
    { eventType: 'COMPLETED_OK', timestamp: '10:35:00Z', duration: 291 },
  ]
}
```

---

## 3. COMPONENT-BY-COMPONENT CLEANUP

### GlobalPopup.jsx
**Current issues:**
- [ ] Multiple `socket.on('...')` listeners not deduplicated
- [ ] Timer refs not cleaned up
- [ ] State animations may ignore incoming updates
- [ ] Local decision logic for popup display

**Fixes needed:**
```javascript
// ✅ CORRECT pattern
class GlobalPopup extends React.Component {
  componentDidMount() {
    this.socket = getSocket();
    
    // Single consolidated listener
    this.socket.on('machine_state', this.handleMachineStateChange);
    this.socket.on('plc:error', this.handlePlcError);
    this.socket.on('watchdog:alert', this.handleWatchdogAlert);
  }
  
  componentWillUnmount() {
    // Clean up ALL listeners
    this.socket.off('machine_state', this.handleMachineStateChange);
    this.socket.off('plc:error', this.handlePlcError);
    this.socket.off('watchdog:alert', this.handleWatchdogAlert);
  }
  
  handleMachineStateChange = (state) => {
    // Only update state, no business logic
    this.setState({ currentMachineState: state });
  }
  
  render() {
    const { currentMachineState } = this.state;
    if (!currentMachineState) return null;
    
    // Render based ONLY on backend state
    const severity = this.getSeverityFromBackendState(currentMachineState);
    return <PopupDisplay severity={severity} state={currentMachineState} />;
  }
}
```

---

### Machine.jsx
**Current issues:**
- [ ] Local machine operation state
- [ ] Polling machine status independently
- [ ] Frontend calculation of cycle duration
- [ ] Local PASS/FAIL assignment

**Fixes needed:**
```javascript
// Remove:
// - this.state.operationInProgress
// - this.state.cycleStartTime
// - Local calculation of resultPass
// - Independent fetch calls to machine endpoints

// Replace with:
class Machine extends React.Component {
  render() {
    const { machineState } = this.props; // From Redux or parent
    
    if (!machineState) return <Loading />;
    
    return (
      <div>
        <MachineStatus state={machineState.state} />
        <OperationDisplay 
          partId={machineState.partId}
          result={machineState.result} // Backend decides
          cycleDuration={machineState.cycleEndTime - machineState.cycleStartTime}
        />
      </div>
    );
  }
}
```

---

### OperatorView.jsx
**Current issues:**
- [ ] Complex state management
- [ ] Local operation tracking
- [ ] Timeline reconstruction from events
- [ ] Status polling

**Fixes needed:**
```javascript
// Use backend operation timeline directly
const OperatorView = ({ operationTimeline }) => {
  if (!operationTimeline) return <Loading />;
  
  return (
    <OperationTimeline
      events={operationTimeline.events} // From backend, no reconstruction
      cycleDuration={operationTimeline.cycleEndTime - operationTimeline.cycleStartTime}
      result={operationTimeline.result}
    />
  );
};
```

---

### StationControls.jsx
**Current issues:**
- [ ] Local station state
- [ ] Independent machine control status polling
- [ ] Feature flag determination

**Fixes needed:**
```javascript
// Backend provides feature flags
const StationControls = ({ stationFeatures, machineState }) => {
  return (
    <div>
      {stationFeatures.canManualStart && <ManualStartButton />}
      {stationFeatures.canManualStop && <ManualStopButton />}
      <MachineStatus state={machineState.state} />
    </div>
  );
};
```

---

### IoMonitor.jsx
**Current issues:**
- [ ] Independent polling of registers
- [ ] Local register state
- [ ] Duplicate PLC signal reads
- [ ] Register caching without coordination

**Fixes needed:**
```javascript
// Use optimized batch reads from backend
const IoMonitor = ({ plcRegisters }) => {
  // plcRegisters from socket.io broadcast
  // No local polling
  
  return (
    <RegisterDisplay
      registers={plcRegisters}
      timestamp={plcRegisters.timestamp}
    />
  );
};
```

---

## 4. REQUIRED BACKEND-FRONTEND CONTRACT

### What Backend Broadcasts (Socket.IO)
```javascript
// Every 5s or on change
socket.emit('machine_status', {
  machineId: 1,
  state: 'RUNNING',
  partId: 'PART-123',
  result: 'PENDING', // Backend decides
  lastUpdate: new Date().toISOString(),
});

// On state transition
socket.emit('machine_state_transition', {
  machineId: 1,
  previousState: 'START_SENT',
  newState: 'RUNNING',
  timestamp: new Date().toISOString(),
});

// On PLC error
socket.emit('plc:error', {
  machineId: 1,
  error: 'PLC_TIMEOUT',
  details: { ... }
});

// Batch register update (instead of individual polls)
socket.emit('plc_registers_update', {
  endpoint: '192.168.1.100:502',
  registers: { R2060: 100, R2061: 200, ... },
  timestamp: new Date().toISOString(),
});

// Operation timeline (instead of frontend reconstructing)
socket.emit('operation_timeline', {
  operationId: 12345,
  events: [ ... ],
  result: 'PASS',
  cycleDuration: 291000,
});
```

### What Frontend May Request (REST/RPC)
```javascript
// Diagnostic queries only (not polling)
GET /api/v1/machines/:id/timeline?limit=10&days=7
GET /api/v1/machines/:id/health
GET /api/v1/metrics
GET /api/v1/watchdog/status

// Actions only (not state queries)
POST /api/v1/machines/:id/manual-start
POST /api/v1/machines/:id/reset
```

---

## 5. MIGRATION CHECKLIST

- [ ] Audit all files for local PASS/FAIL logic
- [ ] Remove duplicate WebSocket listeners
- [ ] Add cleanup for all intervals/timers
- [ ] Replace polling with Socket.IO broadcasts
- [ ] Remove stale component state
- [ ] Update Redux store to only mirror backend
- [ ] Remove local decision heuristics
- [ ] Consolidate register polling
- [ ] Update OperationTimeline to use backend data
- [ ] Test with stale state/late arrivals
- [ ] Performance test with Socket.IO broadcasts
- [ ] Document new component props

---

## 6. TESTING CHECKLIST

- [ ] Send machine_state events out of order - frontend should handle
- [ ] Send multiple rapid state changes - no duplicates
- [ ] Disconnect socket for 10s - UI shows disconnected, recovers on reconnect
- [ ] Restart backend - frontend stays stable
- [ ] Rapid scans on same machine - no race conditions
- [ ] Check memory: run for 1 hour, no leak
- [ ] Monitor WebSocket messages: no duplicates
- [ ] Verify no local PASS/FAIL logic executes

---

## 7. PERFORMANCE TARGETS

- [ ] Max 3 WebSocket listeners per component
- [ ] No intervals/timers with >5 second TTL
- [ ] Memory usage stable over 24h
- [ ] No component re-renders without prop change
- [ ] Socket.IO message < 1KB average
- [ ] Frontend render < 16ms (60fps)

