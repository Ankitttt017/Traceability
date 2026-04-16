# Traceability Process (Current Implementation)

Last updated: 2026-04-04 (rev 2)

Reference standard document:
- `TRACEABILITY_STANDARD_MASTER_PROCESS.md` (authoritative SOP for OK/NG, Quality Check, confirmation, report, downtime behavior)

This document defines the current end-to-end process used in this project, from machine/PLC setup to live I/O monitoring, scan processing, PLC handshake, completion, reset, and bypass.

## 1) Configuration Flow

### 1.1 PLC Range Setup
- Page: `PlcConfiguration`
- Defines PLC endpoint + reserved register block for a protocol.
- Used by Machine page to avoid register collisions across machines.

### 1.2 Machine Setup
- Page: `Machine`
- Key fields:
  - Identity: machine, line, operation/station, sequence
  - PLC protocol: `TCP_TEXT` / `MODBUS_TCP` / `SLMP`
  - PLC endpoint: IP, port
  - SLMP options: device family (`D`, `W`, `R`, etc.), frame mode (`AUTO`/`ASCII`/`BINARY`)
  - Register role mapping: trigger/status/part/station/reset
  - Tuning values: start/started/end-ok/end-ng/block/reset values
  - Live register mapping: label, register, direction, device, description
- New outputs:
  - `Download Excel` (clean CSV sheet for PLC developer handoff)
  - `Bypass` action per machine (machine-level enable/disable, no part ID needed)

## 2) Runtime PLC Contract (Current)

Core handshake register roles:
- `startRegister`: SW writes command (`startValue`, `blockValue`, or `0`)
- `statusRegister`: SW reads PLC acknowledgment / state
- `resetRegister`: SW writes reset value
- Optional:
  - `partRegister`: SW writes part/hash payload
  - `stationRegister`: SW writes station/hash payload
  - `heartbeatRegister`: optional comm-health register

Important:
- Current command model uses same `startRegister` with different values for start/block.
- Status confirmation is read from `statusRegister` using tuning values (`started/endOk/endNg`).
- For SLMP, `partRegister` and `stationRegister` are treated as 32-bit payload windows (2 words each). Avoid overlap.

## 3) Scan to Handshake Flow

Primary endpoints:
- `POST /scan/process`
- `POST /traceability/verify`
- `POST /plc/operation/start`
- `POST /plc/operation/end`

Typical sequence:
1. Operator scans part.
2. Backend validates route/order/duplicate/interlock constraints.
3. If valid, PLC handshake starts:
   - write trigger/start command
   - poll/read status
   - determine end OK/NG
4. Logs and part status are updated.
5. UI reflects live station and machine states.

## 4) Interlock / Error Paths

If part is duplicate/NG/blocked:
- Flow transitions to interlock/failure path.
- PLC may receive block command (mapped by value).
- Operation and production logs capture reason and PLC status.

Health/error patterns:
- TCP reachable but no SLMP response means frame/route/open-setting mismatch.
- App now separates:
  - transport connectivity
  - register read connectivity

## 5) I/O Monitoring Flow

Page: `IoMonitor`

Current behavior:
- PLC-focused view (scanner card removed from I/O page).
- Shows mapped register table from Machine mapping:
  - signal
  - device/register
  - direction
  - purpose
  - live value
  - status
  - per-row `Read`/`Write`
- `Download Live Spec` exports current runtime mapped values + core settings.

Connection semantics:
- `connected`: derived from transport/read state
- `transportConnected`: TCP reachability
- `readConnected`: mapped register read success

## 6) Reset / Recovery / Bypass Paths

Supported operations:
- `POST /traceability/reset-interlock`
- `POST /traceability/reset-operation`
- `POST /traceability/reset-station`
- `POST /traceability/bypass`

Bypass behavior:
- Machine page bypass now supports machine-level mode toggle (ON/OFF) without `partId`.
- When machine-level bypass is ON, this machine skips part-level interlock/duplicate/sequence blocking in scan verification.
- Existing part-level bypass is still supported if `partId` is provided in API.
- Use only with supervisor approval and a clear reason.

### 6.1 Advanced Station Logic (Dynamic, No Code Change)

Station Control supports per-station advanced configuration:
- `resultPolicy`: `AUTO_OK` or `REQUIRE_RESULT`
- `rejectionSignalMode`: `SINGLE`, `DUAL_ANY`, `DUAL_BOTH`
- `qualityPayloadEnabled`: enable SPC payload capture
- `qualityPayloadKeys`: payload keys to store (example: `reasonCode,diameter,height,cameraNgCode`)

Runtime behavior:
- If `resultPolicy=REQUIRE_RESULT`, scan is blocked until explicit OK/NG is provided.
- Dual rejection mode supports one-signal or two-signal confirmation logic.
- If quality payload capture is enabled, configured SPC keys are stored with operation logs.

## 7) PLC Handover Sheet (Current Export Format)

Machine page `Download Excel` exports a canonical single-sheet CSV:
- `SECTION,FIELD,REGISTER_NO,DEVICE,DIRECTION,VALUES,PURPOSE,MACHINE,LINE,OPERATION`

Sections:
- `META` (protocol/ip/port/slmp settings)
- `CORE_REGISTER` (start/status/part/station/reset/heartbeat)
- `HANDSHAKE` (start/block/running/end ok/end ng/reset)
- `LIVE_REGISTER` (custom mapped live registers)
- `TUNING` (start/started/endOk/endNg/block/reset values)

This is intended for easy sharing with PLC developer and production team.

Example rows:
- `startRegister` -> `WRITE SW->PLC` -> `startValue=Start, blockValue=Block`
- `statusRegister` -> `READ PLC->SW` -> `startedValue=Running, endOkValue=End OK, endNgValue=End NG`
- `partRegister` -> `WRITE SW->PLC` -> optional payload/hash
- `stationRegister` -> `WRITE SW->PLC` -> optional station/hash payload
- `resetRegister` -> `WRITE SW->PLC` -> `resetValue=Reset`
- `heartbeatRegister` -> `BOTH PLC<->SW` -> optional link health check
- Live mapped registers are appended with their configured direction and purpose.

Recommended standard matrix:

| Register          | Direction | Purpose                       | Required |
| ----------------- | --------- | ----------------------------- | -------- |
| Start             | WRITE     | Trigger/block machine command | Must     |
| Status            | READ      | Running / End OK / End NG     | Must     |
| Part ID Payload   | WRITE     | Part hash/payload             | Optional |
| Station Payload   | WRITE     | Station hash/payload          | Optional |
| Reset             | WRITE     | Clear/fault reset             | Must     |
| Heartbeat         | BOTH      | Connection check              | Optional |

## 8) SLMP Specific Notes

Frame support:
- `AUTO` (tries ASCII then Binary), `ASCII`, `BINARY`

Route candidates are tried when needed:
- `networkNo/plcNo/ioNo/stationNo` combinations

Timeout handling:
- I/O snapshot uses extended API timeout and faster SLMP route probing to reduce frontend timeout failures.

## 9) Required Verification Checklist

For SW + PLC team signoff:
1. Confirm PLC open setting matches selected protocol/frame mode.
2. Confirm IP/port reachable from app host.
3. Confirm route parameters for SLMP.
4. Confirm register map and direction agreement for each signal.
5. Confirm value semantics for start/block/status/end/reset.
6. Validate duplicate/NG/interlock behavior with real test parts.
7. Validate reset and bypass audit behavior.
8. Validate post-timeout behavior: `Reset Operation` must be required before re-scan.
9. For SLMP payloads, confirm no 2-word overlap between `partRegister` and `stationRegister`.
10. Export and share:
   - Machine `Download Excel`
   - IoMonitor `Download Live Spec`

## 10) API Reference (Core)

Read/monitor:
- `GET /traceability/live-state`
- `GET /traceability/io-snapshot`
- `GET /traceability/plc-health`
- `GET /traceability/scanner-health`
- `GET /traceability/machine-stats`

Process/control:
- `POST /scan/process`
- `POST /traceability/verify`
- `POST /plc/operation/start`
- `POST /plc/operation/end`
- `POST /traceability/rework`
- `POST /traceability/reset-interlock`
- `POST /traceability/reset-operation`
- `POST /traceability/reset-station`
- `POST /traceability/bypass`

## 11) Deliverables for PLC Developer

Provide these generated files per machine:
1. Machine page: `<machine>_plc_register_spec.csv`
2. I/O page: `<machine>_io_live_register_spec.txt`

These include register numbers, direction, value semantics, tuning, and current runtime values for joint debugging and commissioning.
