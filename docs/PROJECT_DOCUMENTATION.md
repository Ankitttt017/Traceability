# Tracebility Project Documentation

Last updated: 2026-02-23

## 1. Purpose

Tracebility is an industrial production traceability platform designed for live manufacturing lines where machines must keep running and operators need simple, fast pass/fail visibility.

The software handles:
- Scanner-to-station traceability
- QR validation with dynamic regex rules
- PLC operation handshake (start/end OK/NG)
- Interlock prevention and recovery
- Live production dashboards and reports
- Packing with configurable box capacity

## 2. Current Architecture

### 2.1 Frontend
- Stack: React + Vite + Tailwind + Socket.IO client + Axios
- Entry routing: `frontend/src/App.jsx`
- Main shell layout: `frontend/src/layouts/MainLayout.jsx`
- Navigation pages:
  - Dashboard
  - Master Settings Dashboard
  - Production
  - Machines
  - Scanners
  - Shifts
  - QR Rules
  - Users
  - Component Journey
  - Operator View
  - Packing

### 2.2 Backend
- Stack: Node.js + Express + Sequelize + MySQL + Socket.IO
- Entry point: `backend/server.js`
- API base paths:
  - `/api/v1/*`
  - `/api/*` (compat path)
- Auth routes:
  - `/api/v1/auth/*`
  - `/api/auth/*`

### 2.3 Device Integration
- Scanner TCP server: `backend/tcp/tcpServer.js`
- PLC handshake service: `backend/services/plcSocketService.js`
- Supported PLC protocols:
  - `TCP_TEXT`
  - `MODBUS_TCP`

### 2.4 Realtime Layer
- Socket service: `backend/services/realtimeService.js`
- Socket server path: `/socket.io/`
- Event bridge automatically publishes:
  - `scan_event`
  - `operator_popup`
  - `journey_update`
  - `dashboard_refresh`
  - `packing_update`

## 3. Design Approach Used in This Project

### 3.1 DB-driven station flow
Station sequence is not hard-coded in frontend. It is resolved from active machines ordered by `sequence_no`, using `operation_no` as station stage.

### 3.2 Parallel machine support
Multiple physical machines can share the same operation stage (`operation_no`).
- Traceability validates by stage, not only by physical machine.
- Duplicate scan for already completed stage gets blocked.

### 3.3 Scanner IP mapping as source of truth
Scanner payload is trusted only when scanner IP is mapped to an active machine/station.
- Mapping table: `Scanner`
- Machine availability check: `Machine.is_active`

### 3.4 Hybrid realtime strategy (fast + safe)
The UI uses Socket.IO for near-live updates and throttled API refresh as verification.
- Component Journey realtime cooldown: 700 ms
- Operator View realtime cooldown: 700 ms
- Master Dashboard realtime cooldown: 1200 ms
- Component Journey fallback polling: 30 seconds

This avoids UI spam when many events arrive at once and still keeps data consistent.

### 3.5 Operator-first status language
UI is intentionally color and badge based:
- Green: pass
- Red: fail
- Amber: running/intermediate
- Grey: waiting

This is aligned with shop-floor usability where quick visual interpretation is critical.

## 4. Core Data Model

### 4.1 Machine
`backend/models/Machine.js`
- Stage identity: `operation_no`
- Sequence: `sequence_no`
- PLC config: protocol/IP/port/register/value fields
- Activation: `status`, `is_active`

### 4.2 Scanner
`backend/models/Scanner.js`
- `scanner_ip` -> `mapped_machine_id`
- Active/inactive control

### 4.3 Part
`backend/models/Part.js`
- `status`: `IN_PROGRESS`, `COMPLETED`, `NG`, `INTERLOCKED`, `REWORK`
- `current_station`, `current_operation`
- interlock and rework flags

### 4.4 OperationLog
`backend/models/OperationLog.js`
- PLC lifecycle per part/station attempt:
  - `PENDING`
  - `STARTED`
  - `ENDED_OK`
  - `ENDED_NG`
  - `INTERLOCKED`
- interlock and bypass trace fields

### 4.5 ProductionLog
`backend/models/ProductionLog.js`
- Finalized quality records for dashboard/reporting
- `status`: `OK` or `NG`
- `ng_reason`

### 4.6 QrFormatRule
`backend/models/QrFormatRule.js`
- Dynamic regex validation rules
- Single active rule logic enforced on create/update

### 4.7 Packing
- Session: `PackingSession` (`OPEN`/`CLOSED`, capacity, packed_count)
- Items: `PackingItem` (part to slot mapping)

## 5. End-to-End Runtime Logic

### 5.1 Scanner message to decision
1. Scanner sends raw text to backend TCP server.
2. Backend resolves scanner by source IP.
3. Backend resolves mapped machine and station.
4. `saveScan()` validates:
   - QR regex (active rule)
   - part already completed/interlocked checks
   - duplicate station check
   - sequence check (expected next station)
5. Decision returned to scanner:
   - `ALLOW`
   - `BLOCK`

### 5.2 If decision is ALLOW
1. Operation log created with `PENDING`.
2. PLC handshake starts (TCP_TEXT or MODBUS_TCP).
3. On ACK start -> `STARTED`.
4. On end OK -> `ENDED_OK`, part advances or completes.
5. On end NG -> `ENDED_NG`, part becomes NG/interlocked.
6. On timeout/failure -> `INTERLOCKED` with reason like `PLC_TIMEOUT_*`.

### 5.3 Realtime broadcast
On each important decision, backend emits socket events for live pages.
`operator_popup` and `scan_event` also auto-generate `journey_update` payloads.

## 6. Critical UI Logic: QR Decision vs Operation Decision

This is the most important approach in current build.

### 6.1 Why this separation is necessary
In live production, scanner validation and PLC operation are different steps.
- QR can pass first.
- PLC may still fail later (timeout/NG/interlock).

If mixed into one badge, operators cannot understand what failed.

### 6.2 Current implementation

#### Component Journey
File: `frontend/src/pages/ComponentJourney.jsx`
- QR decision parsing accepts multiple payload keys:
  - `decision`, `outcome`, `scanOutcome`, `qrDecision`, `qrStatus`
  - fallback from `reason/result`
- Station card now shows both:
  - `QR PASS/FAIL/WAIT`
  - `OP PASS/FAIL/RUN/WAIT`
- Each station includes Reset action.
- Includes Last QR Result and Live QR Feed.

#### Operator View
File: `frontend/src/pages/OperatorView.jsx`
- Same robust QR decision parsing as above.
- Separate cards:
  - `QR Decision`
  - `Operation Decision` (derived from `plcStatus`)
- Live QR feed retained per station/machine relevance.

### 6.3 Outcome mapping used by UI
QR mapping:
- PASS group: `ALLOW`, `PASS`, `OK`, `ACCEPT`, `VALID`
- FAIL group: `BLOCK`, `FAIL`, `NG`, `REJECT`, `INVALID`

Operation mapping:
- PASS: `ENDED_OK`, `PASSED`
- FAIL: `ENDED_NG`, `INTERLOCKED`, `FAILED`
- RUN: `STARTED`, `PENDING`, `IN_PROGRESS`
- WAIT: otherwise

## 7. Master Settings and Station Requirement Matrix

File: `frontend/src/pages/MasterSettingsDashboard.jsx`

### 7.1 Purpose
Single command-center page for:
- Master Dashboard
- Station Controls
- Report Dashboard

### 7.2 Station requirement matrix
Controls per station:
- QR validation required
- Operation check required
- Rejection bin required

Storage approach:
- Local storage key: `traceability-station-feature-settings-v1`
- Utility: `frontend/src/utils/stationSettings.js`
- Defaults: QR=true, OP=true, REJ=true

Preset options:
- Strict Quality
- Speed Focus
- Balanced

### 7.3 Packing default control
Master settings stores default box capacity in local storage key:
- `packing-default-capacity`

Used by packing page as default start-box capacity.

## 8. Packing Logic Approach

Backend service: `backend/services/packingService.js`
Frontend page: `frontend/src/pages/Packing.jsx`

Rules:
- Capacity is dynamic per box (not fixed 65 only).
- Allowed capacity range: 1 to 500.
- Only `COMPLETED` parts can be packed.
- One part can be packed only once.
- Box auto-closes when capacity reached.
- Live `packing_update` socket event updates UI slots.

## 9. Realtime Event Contract

Common event fields used in frontend:
- `partId` / `part_id`
- `stationNo` / `station_no`
- `machineId` / `machine_id`
- `decision` or `outcome`
- `reason`
- `message`
- `timestamp`
- `sourceEvent`

Backend room support:
- Client can subscribe by part via:
  - `subscribe_part`
  - `unsubscribe_part`
- Room name format: `part:<partId>`

## 10. API Surface (Current)

### 10.1 Auth
- `POST /auth/login`
- `POST /auth/register`

### 10.2 Master data
- `GET/POST/PUT/DELETE /machines`
- `GET/POST/PUT/DELETE /scanners`
- `GET/POST/PUT/DELETE /shifts`
- `GET/POST/PUT/DELETE /users` (admin guarded)
- `GET/POST/PUT/DELETE /qr-format-rules`

### 10.3 Traceability
- `GET /traceability/operations`
- `GET /traceability/parts`
- `GET /traceability/journey/:partId`
- `GET /traceability/:partId`
- `GET /traceability/live-state?machineId=...`
- `GET /traceability/machine-stats?machineId=...`
- `POST /traceability/verify`
- `POST /scan/process`
- `POST /plc/operation/start`
- `POST /plc/operation/end`
- `POST /traceability/rework`
- `POST /traceability/reset-interlock`
- `POST /traceability/reset-station`
- `POST /traceability/bypass`

### 10.4 Dashboard/report
- `GET /dashboard/summary`
- `GET /dashboard/trends`
- `GET /dashboard/report`
- `GET /dashboard/report/export`

### 10.5 Packing
- `GET /packing/overview`
- `GET /packing/box/:boxNumber`
- `POST /packing/start-box`
- `POST /packing/scan`

## 11. Production Reliability Practices in Current Code

- Scanner messages validated and guarded by IP mapping.
- Sequence enforcement prevents skip operations.
- Duplicate stage scans blocked.
- Interlock path is explicit with reason persistence.
- PLC handshake has timeout + retry.
- UI has realtime throttling to prevent overload on burst events.
- Dashboard/Operator/Component screens all refresh after critical events.

## 12. Environment and Runtime Configuration

Backend `.env` main keys:
- `PORT`, `TCP_PORT`
- `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_HOST`
- `JWT_SECRET`
- `DEFAULT_ADMIN_*`
- PLC tuning:
  - `PLC_CONNECT_TIMEOUT_MS`
  - `PLC_START_ACK_TIMEOUT_MS`
  - `PLC_END_ACK_TIMEOUT_MS`
  - `PLC_RETRY_COUNT`
  - `PLC_MODBUS_POLL_INTERVAL_MS`
- optional packing default:
  - `DEFAULT_PACKING_CAPACITY`

Frontend `.env`:
- `VITE_API_BASE_URL`
- `VITE_SOCKET_URL`

## 13. Quick Operational Notes for Team

- If scanner response is `ALLOW` but station still ends red, check PLC end/interlock event.
- `PLC_TIMEOUT_*` means operation layer failure, not QR validation failure.
- For operator clarity, always treat QR and OP as separate status channels.
- Use Master Settings matrix to keep each station behavior aligned with plant SOP.

## 14. Recommended Next Hardening Steps

1. Persist station feature matrix in backend DB (not only local storage) for multi-device consistency.
2. Add event schema versioning for socket payloads.
3. Add acknowledgement IDs for exactly-once event handling in high-volume lines.
4. Add role-based action audit table for reset/bypass/rework actions.
5. Add line-level health endpoint with scanner/PLC connectivity heartbeat.
