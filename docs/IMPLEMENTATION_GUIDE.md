# Industrial Implementation Guide

This guide describes the minimum steps to deploy the traceability system at any plant.

## 1. Plant Onboarding Checklist

1. Create production users and roles (`Admin`, `Supervisor`, `Operator`).
2. Configure machine master data (one row per physical machine).
3. Configure scanner-to-machine IP mappings.
4. Configure active QR format regex rule.
5. Configure shift definitions.
6. Validate scan + PLC handshake on one machine.
7. Enable full line.

## 2. Machine Configuration

Machine settings are fully DB-driven from the `Machines` page.

Required:

- `machineName`
- `operationNo`
- `sequenceNo`
- `machineIp`

PLC:

- `plcProtocol`: `TCP_TEXT` or `MODBUS_TCP`
- `plcIp`, `plcPort`

For `MODBUS_TCP`, configure:

- `plcUnitId`
- `plcStartRegister`
- `plcStatusRegister`
- optional: `plcPartRegister`, `plcStationRegister`, `plcResetRegister`
- value mapping: `plcStartValue`, `plcStartedValue`, `plcEndOkValue`, `plcEndNgValue`

## 3. Parallel Machines (Same Operation)

If multiple machines perform the same process stage:

- set same `operationNo` on all those machines.
- map each scanner to its own machine IP.

Result: once a part completes that operation on one machine, duplicate scan on another same-operation machine is blocked.

## 4. Scanner Data Contract

Production scan payload:

```text
PART_ID
```

Packing payload (supported examples):

```text
PACK|BOX:BX001
PACK|BOX:BX001|PART:PART123
BOX:BX001|PART:PART123
```

## 5. Interlock Rules

Part is blocked/interlocked when:

- QR format mismatch
- duplicate operation scan
- previous operation incomplete (skip attempt)
- part already interlocked/completed
- PLC timeout/failure
- PLC end NG

Recovery methods:

- `Reset Interlock`
- `Rework`
- controlled `Bypass`

## 6. Shift Setup

Use `Shifts` page to define active windows:

- `shiftCode`
- `startTime`
- `endTime`

Dashboard/reporting shift analytics are computed dynamically from these definitions.

## 7. Performance Notes

- Keep scanner and backend on stable LAN.
- Keep PLC response timeout realistic for operation cycle time.
- Use Modbus poll interval as per PLC scan cycle.
- Keep DB indices healthy for `part_id`, `machine_id`, and `createdAt`.
