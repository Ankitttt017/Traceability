# Tracebility

Industry-focused traceability system with dynamic QR validation, scanner-to-machine IP mapping, PLC handshake, interlock logic, live operator feedback, and packing management.

## Stack

- Frontend: React (Vite), Tailwind, Axios, Socket.IO client, Recharts
- Backend: Node.js, Express, Sequelize, MySQL, Socket.IO
- Device Integration: TCP server for scanner input and PLC handshake

## Core Capabilities

- Dynamic machine/station setup from DB
- Parallel machine support for same operation stage
- Scanner IP management mapped to stations
- Dynamic QR regex rule management (active rule validation)
- Skip prevention and interlock logic
- PLC handshake flow with retry/timeout (TCP text + Modbus TCP)
- Dynamic shift management for reporting/filtering
- Live operator popups and event feed
- Dashboard summary/report/export
- Part journey, rework, interlock reset
- Bypass operation (controlled manual override)
- Packing station with 65-slot live fill visualization

## Project Structure

```text
Tracebility/
  backend/
    config/
    controllers/
    middleware/
    models/
    routes/
    services/
    tcp/
    server.js
  frontend/
    src/
      api/
      components/
      constants/
      layouts/
      pages/
      utils/
```

## Environment

Create `backend/.env`:

```env
DB_NAME=tracebility
DB_USER=root
DB_PASS=
DB_HOST=localhost
JWT_SECRET=supersecretkey123
PORT=4000
TCP_PORT=5000
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin123
DEFAULT_ADMIN_ROLE=Admin

# PLC tuning
PLC_CONNECT_TIMEOUT_MS=2000
PLC_START_ACK_TIMEOUT_MS=3000
PLC_END_ACK_TIMEOUT_MS=120000
PLC_RETRY_COUNT=3
PLC_MODBUS_POLL_INTERVAL_MS=150
```

Optional `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:4000/api/v1
VITE_SOCKET_URL=http://localhost:4000
```

## Run

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Device Communication Flow

### 1. Scanner to Backend (TCP/IP)

- Scanner sends raw text to backend TCP port (`TCP_PORT`, default `5000`).
- For production scanning: send `PART_ID` as single line.
- Backend identifies scanner by source IP (`socket.remoteAddress`).
- IP is matched against `Scanner.scanner_ip` and mapped to machine station.
- Backend validates part via dynamic flow:
  - Active QR regex rule
  - Duplicate/completed/interlocked checks
  - Sequence check (`previous station completed`)
- Scanner receives response:
  - `ALLOW`
  - `BLOCK`

### 2. PLC Handshake (TCP/IP / Modbus TCP)

Each machine supports protocol selection via DB field `plc_protocol`:

- `TCP_TEXT` (legacy string ACK mode)
- `MODBUS_TCP` (register-based mode)

#### TCP_TEXT mode

When scan is `ALLOW`, backend sends to PLC:

```text
START_OPERATION|<partId>|<stationNo>
```

PLC should respond:

```text
ACK_START|<partId>
ACK_END_OK|<partId>
```

or

```text
ACK_START|<partId>
ACK_END_NG|<partId>
```

Backend behavior:

- `ACK_START`: operation log -> `STARTED`
- `ACK_END_OK`: log -> `ENDED_OK`, part moves forward/completes
- `ACK_END_NG`: log -> `ENDED_NG`, part becomes interlocked/NG
- Timeout/error: retry up to `PLC_RETRY_COUNT`; then interlock

#### MODBUS_TCP mode

Machine configuration fields:

- `plc_unit_id`
- `plc_start_register`
- `plc_status_register`
- optional: `plc_part_register`, `plc_station_register`, `plc_reset_register`
- value mapping: `plc_start_value`, `plc_started_value`, `plc_end_ok_value`, `plc_end_ng_value`

Flow:

1. Write start command register.
2. Poll status register for started value.
3. Poll status register for end OK/NG value.
4. Apply result and interlock logic exactly like TCP_TEXT mode.

Part/station can be written as hashed numeric values to optional registers (for PLC-side validation/interlock).

## Parallel Machines (Same Operation)

If you have `M1`, `M2`, `M3` for the same operation:

- Configure all three with the same `operation_no` (example: `OP-20`).
- Each machine can still have different scanner IP mapping.
- System tracks completion by operation stage (`operation_no`) not by physical machine.
- Once part completes `OP-20` on any one machine, next scan on another parallel machine with `OP-20` is blocked as duplicate.

This prevents part from being machined twice for the same operation.

### 3. Packing Scanner Payload

Supported TCP patterns:

- `PACK|BOX:BX001` (start or resume box)
- `PACK|BOX:BX001|PART:PART123`
- `BOX:BX001|PART:PART123`

Backend emits live `packing_update` events for UI slot filling.

## Frontend Pages

- Dashboard: always visible, dynamic filters, report and charts
- Production: dynamic charting from live report data
- Traceability: search-by-part workflow (no manual scan trigger)
- Machines: machine/station config; scanner mapping shown from scanner table
- Scanners: scanner IP to machine assignment
- QR Rules: active regex management
- Part Journey: station timeline + rework + interlock reset
- Operator View: live station monitoring, popups, bypass control
- Packing: 65-slot visual packing board with live updates
- Shifts: create/update shift windows used by dashboard filters and shift production summary

## API Base

- Base: `/api/v1`
- Auth: `/auth/*`
- Machines: `/machines`
- Scanners: `/scanners`
- Users: `/users`
- Shifts: `/shifts`
- Traceability: `/traceability/*`, `/scan/process`, `/plc/operation/*`
- Dashboard: `/dashboard/*`
- Packing: `/packing/*`

## Notes

- Avoid configuring scanner IP in machine form; scanner mapping is managed in `Scanners` page only.
- All critical operation decisions should come from scanner TCP feed and PLC ACK, not manual UI input.
- For parallel machines in same operation, keep same `operation_no` and system will block duplicate machining for same part.
- Detailed rollout: `docs/IMPLEMENTATION_GUIDE.md`.
