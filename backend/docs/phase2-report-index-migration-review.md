# Phase 2 Report Index Migration Review

Status: prepared only. Do not run on production until explicitly approved.

Migration file:

```text
migrations/20260711120000-add-report-performance-indexes.js
```

Run command, after approval only:

```bash
npm run db:migrate
```

Rollback command:

```bash
npm run db:migrate:undo
```

The migration is idempotent: each `up` index is created only if the target table exists and the index does not already exist. Each `down` rollback drops only if the table and index exist.

## Live Baseline Used For This Migration

Read-only baseline was collected from live MSSQL using the configured `.env` connection. No schema changes were made.

Row counts:

```text
OperationLogs:     46,012
PlcCycleReadings:  30,532
Parts:             12,067
PartCodeMappings:   8,411
Machines:               9
LinePartAssignments:    4
```

Growth:

```text
OperationLogs:    177 rows last 24h, 35,115 rows last 7d, avg 5,016.43/day
PlcCycleReadings: 2,660 rows last 24h, 15,623 rows last 7d, avg 2,231.86/day
```

Already covered by existing indexes:

```text
OperationLogs(createdAt)                  -> IX_OperationLogs_CreatedAt
OperationLogs(part_id)                    -> IX_OperationLogs_PartId
Parts(part_id)                            -> unique key on part_id
PartCodeMappings(old_part_id)             -> unique key on old_part_id
PartCodeMappings(customer_qr)             -> unique key on customer_qr
PlcCycleReadings(recorded_at)             -> IX_PlcCycleReadings_RecordedAt
LinePartAssignments(plant_id, line_id)    -> line_part_assignments_plant_id_line_id
LinePartAssignments(part_name)            -> line_part_assignments_part_name
LinePartAssignments(die_name)             -> line_part_assignments_die_name
LinePartAssignments(die_casting_machine)  -> line_part_assignments_die_casting_machine
```

Therefore the migration intentionally creates only the missing/high-value indexes below. This avoids redundant write overhead on continuously inserted manufacturing tables.

## Up SQL

```sql
IF OBJECT_ID(N'[dbo].[OperationLogs]', N'U') IS NOT NULL
AND NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_OperationLogs_machine_id_createdAt_desc'
    AND object_id = OBJECT_ID(N'[dbo].[OperationLogs]')
)
BEGIN
  CREATE INDEX [IX_OperationLogs_machine_id_createdAt_desc] ON [dbo].[OperationLogs] ([machine_id], [createdAt] DESC);
END
```

```sql
IF OBJECT_ID(N'[dbo].[OperationLogs]', N'U') IS NOT NULL
AND NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_OperationLogs_station_no_createdAt_desc'
    AND object_id = OBJECT_ID(N'[dbo].[OperationLogs]')
)
BEGIN
  CREATE INDEX [IX_OperationLogs_station_no_createdAt_desc] ON [dbo].[OperationLogs] ([station_no], [createdAt] DESC);
END
```

```sql
IF OBJECT_ID(N'[dbo].[Parts]', N'U') IS NOT NULL
AND NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_Parts_updatedAt_desc'
    AND object_id = OBJECT_ID(N'[dbo].[Parts]')
)
BEGIN
  CREATE INDEX [IX_Parts_updatedAt_desc] ON [dbo].[Parts] ([updatedAt] DESC);
END
```

```sql
IF OBJECT_ID(N'[dbo].[PlcCycleReadings]', N'U') IS NOT NULL
AND NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_PlcCycleReadings_machine_ip_shot_recorded_desc'
    AND object_id = OBJECT_ID(N'[dbo].[PlcCycleReadings]')
)
BEGIN
  CREATE INDEX [IX_PlcCycleReadings_machine_ip_shot_recorded_desc] ON [dbo].[PlcCycleReadings] ([machine_name], [plc_ip], [shot_number], [recorded_at] DESC);
END
```

## Down SQL

Rollback runs in reverse order:

```sql
IF OBJECT_ID(N'[dbo].[PlcCycleReadings]', N'U') IS NOT NULL
AND EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_PlcCycleReadings_machine_ip_shot_recorded_desc'
    AND object_id = OBJECT_ID(N'[dbo].[PlcCycleReadings]')
)
BEGIN
  DROP INDEX [IX_PlcCycleReadings_machine_ip_shot_recorded_desc] ON [dbo].[PlcCycleReadings];
END
```

```sql
IF OBJECT_ID(N'[dbo].[Parts]', N'U') IS NOT NULL
AND EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_Parts_updatedAt_desc'
    AND object_id = OBJECT_ID(N'[dbo].[Parts]')
)
BEGIN
  DROP INDEX [IX_Parts_updatedAt_desc] ON [dbo].[Parts];
END
```

```sql
IF OBJECT_ID(N'[dbo].[OperationLogs]', N'U') IS NOT NULL
AND EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_OperationLogs_station_no_createdAt_desc'
    AND object_id = OBJECT_ID(N'[dbo].[OperationLogs]')
)
BEGIN
  DROP INDEX [IX_OperationLogs_station_no_createdAt_desc] ON [dbo].[OperationLogs];
END
```

```sql
IF OBJECT_ID(N'[dbo].[OperationLogs]', N'U') IS NOT NULL
AND EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_OperationLogs_machine_id_createdAt_desc'
    AND object_id = OBJECT_ID(N'[dbo].[OperationLogs]')
)
BEGIN
  DROP INDEX [IX_OperationLogs_machine_id_createdAt_desc] ON [dbo].[OperationLogs];
END
```
