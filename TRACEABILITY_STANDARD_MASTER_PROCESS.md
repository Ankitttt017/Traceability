# Traceability Standard Master Process

Last updated: 2026-04-06
Applies to: Entire project (all lines, all stations, all machine types)

This is the standard operating document for our software. It defines what we send, what we read, what we confirm, and what happens in each case (OK/NG/error/bypass/no-result).

## 1) Purpose

Our software is designed to be line-independent and station-independent.

Goals:
- Same core flow for every station.
- Config-based behavior (no code change for new station mapping).
- Clear PLC communication contract.
- Clear Quality Check (SPC/gauge) contract.
- Clear reporting and downtime tracking behavior.

## 2) Core Building Blocks

- Machine configuration:
  - Line, sequence, operation/station.
  - PLC endpoint and protocol.
  - Register mapping and tuning values.
  - Optional Quality Check config.
- Station control configuration:
  - QR check, operation validation, PLC handshake, rejection bin, result requirement, parts-per-cycle, final packing.
- Runtime services:
  - Scan receive and validate.
  - PLC handshake and status tracking.
  - Quality result handling.
  - Operator and dashboard events.
  - Report generation.

## 3) Standard Station Flow (Default)

1. Part arrives and is scanned.
2. System validates:
   - QR format/rule
   - sequence/operation
   - duplicate/interlock conditions
3. If allowed, operation log becomes `PENDING`.
4. If PLC handshake enabled:
   - software sends start command to PLC
   - waits for running/end status
5. Final result decided as `OK` or `NG`.
6. Part and logs updated.
7. Operator popup and dashboard refresh emitted.

If PLC handshake is disabled (or machine bypass ON), system can finalize as per station settings without waiting PLC handshake.

## 4) Quality Check (SPC/Gauge) Standard

Quality Check station is still a normal station:
- QR check applies.
- operation/sequence applies.
- PLC handshake applies (if enabled and not bypass).

Only result source is configurable.

### 4.1 Quality Check Mode A: `IP_PUSH`

Use when gauge/SPC software sends payload to our system IP.

Configuration:
- `mode = IP_PUSH`
- `sourceIp` (expected sender IP)
- optional `sourcePort`
- `payloadResultKey` (example: `RESULT`)
- `payloadResultNgValues` (example: `NG,FAIL,0`)

Flow:
1. payload received from system IP.
2. result key read from payload.
3. value mapped to `OK`/`NG`.
4. operation result saved.
5. optional PLC confirmation ACK sent (if enabled).

If source IP does not match configured IP:
- request is blocked with source mismatch reason.

### 4.2 Quality Check Mode B: `PLC_REGISTER`

Use when quality result is available in PLC register.

Configuration:
- `mode = PLC_REGISTER`
- `plcResultRegister` (+ `plcResultDevice` for SLMP)
- `plcResultOkValues` (example: `1,3,OK,PASS`)
- `plcResultNgValues` (example: `0,2,NG,FAIL`)

Flow:
1. scan accepted.
2. software reads configured PLC result register.
3. register value mapped to `OK`/`NG`.
4. operation result saved.
5. optional PLC confirmation ACK sent (if enabled).

If register read fails or value not mapped:
- fallback behavior follows station result policy and manual result logic.

### 4.3 Global Treatment Rule (`ALL`)

Quality Check mapping is treated as standard global logic:
- no hardcoded per-station code path.
- station behavior is driven by machine + station config.

## 5) PLC Confirmation ACK After Result (Receive Confirmation)

When enabled, software confirms to PLC that result was received and processed.

Config:
- `plcAckEnabled`
- `plcAckRegister` (+ `plcAckDevice` for SLMP)
- `plcAckOkValue`
- `plcAckNgValue`
- `plcAckErrorValue`

Write behavior:
- final `OK` -> write `plcAckOkValue`
- final `NG` -> write `plcAckNgValue`
- processing/error fallback -> write `plcAckErrorValue`

This provides explicit “software received and confirmed” feedback to PLC.

## 6) Decision Matrix (If X Missing, Then Y)

### 6.1 Scan/Input Validation

- Invalid/missing part ID:
  - blocked, no operation start.
- station/sequence mismatch:
  - blocked (`PREVIOUS_STATION_NOT_COMPLETED` or station mismatch).
- duplicate at same station:
  - blocked.
- previous PLC comm timeout not reset:
  - blocked until reset.

### 6.2 Result Requirement Cases

- `manualResult` ON and no result from operator/payload/register:
  - blocked (`MANUAL_RESULT_REQUIRED`).
- rejection bin confirmed:
  - final result forced to `NG`.

### 6.3 Quality Check Cases

- Quality mode `IP_PUSH`, source IP mismatch:
  - blocked (source mismatch).
- Quality mode `PLC_REGISTER`, read timeout/error:
  - warning path, then result resolves by available fallback policy.
- Quality mode disabled:
  - normal station result path.

### 6.4 PLC Handshake Cases

- handshake enabled:
  - start -> running -> end OK/NG required from PLC.
- handshake disabled:
  - software finalizes without waiting handshake.
- machine bypass enabled:
  - handshake treated as disabled exactly.

## 7) What We Store (Operationally Important)

- `OperationLog`:
  - station, machine, PLC status, result, reason.
  - `result_source`, `result_input`.
- `Part`:
  - current station/operation, status, interlock flags.
- `ProductionLog`:
  - high-level OK/NG audit.

Note:
- `quality_payload` is not persisted as DB column in current schema.
- Result source and input are persisted for traceability.

## 8) Reporting Standard

Report pages should always reflect:
- line context
- station/operation context
- part-level status progression
- quality outcome (`OK`/`NG`)
- machine-level and station-level summaries

Current reporting sources:
- dashboard report endpoints and machine stats
- operator journey/history data
- production charts exports (CSV/PDF)

### 8.1 Part Journey Reporting Requirement

Per station, show:
- station number
- PLC status
- result
- result source (`QUALITY_CHECK_IP_PAYLOAD`, `QUALITY_CHECK_PLC_REGISTER`, `MANUAL_OK_NG`, etc.)
- interlock/bypass reason if present
- timestamps

## 9) Downtime and Confirmation

Downtime/health visibility comes from:
- PLC health and scanner health snapshots
- operation status transitions
- machine stats/overview metrics

Confirmation points that must be visible:
- QR accepted/rejected
- operation started
- operation ended OK/NG
- PLC comm error
- reset required
- optional quality ACK write success/failure

## 10) Integration Contract (Quality System Team)

### For `IP_PUSH` mode, quality software team must provide:
- source system IP
- payload format
- result key
- NG value list
- send timing (when result is sent)

### For `PLC_REGISTER` mode, PLC team must provide:
- result register and device
- value map for OK/NG
- update timing
- optional ACK register/value map

## 11) Standard API/Runtime Touchpoints

Primary:
- `POST /scan/process`
- `POST /traceability/verify`
- `GET /traceability/live-state`
- `GET /traceability/machine-stats`
- `GET /traceability/journey/:partId`
- reset/bypass endpoints under `/traceability/*`

## 12) Commissioning Checklist (Before Production)

1. Confirm machine register map with PLC team.
2. Confirm Quality Check mode (`IP_PUSH` or `PLC_REGISTER`).
3. Validate one full OK cycle.
4. Validate one NG cycle.
5. Validate communication failure and reset flow.
6. Validate bypass ON/OFF behavior.
7. Validate report export values match runtime values.
8. Validate line/station headings in dashboard and production reports.
9. Validate operator popup messages for each major state.
10. Sign off with PLC + Production + Quality teams.

## 13) Non-Negotiable Standard Rules

- No hidden hardcoded station logic.
- New station onboarding must be config-driven.
- Every major result path must be auditable (`result_source`, status, timestamps, reason).
- If handshake is bypassed, it must be clearly visible in logs/UI.
- Quality confirmation to PLC should be enabled where required by process.
