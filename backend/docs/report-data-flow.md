# Report Data Flow

Scope: read-only documentation for the current report path. This file describes the existing behavior and query order without proposing behavior changes.

Primary endpoint:

```text
GET /api/v1/reports/report/data
```

Route:

```text
routes/v1/reportRoutes.js -> controllers/reportController.getReportData
```

## Controller Flow

1. `getReportData(req, res)` reads query parameters.
2. `getReportOptions(query)` derives execution flags:
   - `fast`
   - `includePlcReadings`
   - `includePlcSummary`
   - `includeLeaktest`
   - `maxAnchorParts`
   - `maxBaseLogs`
3. `stripReportControlFilters(query)` removes paging/control parameters from business filters.
4. `getPagination(query)` computes:
   - `page`
   - `pageSize`
   - `offset`
5. `getCachedReportBundle(filters, options)` resolves the unpaginated report bundle.
6. `paginateReportRowsByPart(rows, pagination)` groups rows in memory by report part key and slices the requested page.
7. Response shape is:
   - `rows`
   - `metrics`
   - `pagination`
   - `plcColumns`
   - `reportMode`
   - `availableShifts`

Important current behavior: pagination happens after `fetchProductionData()` has already fetched and enriched the report rows.

## Cached Bundle Flow

`getCachedReportBundle(filters, options)` runs these concurrently:

1. `fetchProductionData(cleanFilters, options)`
2. `Shift.findAll({ is_active: true })`
3. `getPlcReadingColumns()` unless PLC readings are disabled
4. `fetchPlcShotSummary(cleanFilters)` unless PLC summary is disabled

Then it:

1. Calculates metrics using `calculateProductionMetrics(rows)`.
2. Derives fallback PLC shot summary from returned report rows.
3. Stores bundle in in-memory cache for `REPORT_CACHE_TTL_MS`.

## fetchProductionData Query Order

### Step 1: Normalize Filters

Inputs include:

```text
dateFrom, dateTo, machineId, plantId, lineId, lineName,
shiftCode, modelCode, operationNo, resultType,
barcode, customerCode, station, operatorId, status,
partName, dieName, dieCastingMachine
```

Default date range is last 24 hours when no date is provided.

### Step 2: Optional Barcode Expansion

If `barcode` is present:

```text
resolveReportPartSearchValues(barcode)
```

Queries:

```text
PartCodeMapping.findAll({
  where: old_part_id LIKE %barcode% OR customer_qr LIKE %barcode%
})
```

Also adds numeric shot variants for short numeric searches.

### Step 3: Optional Machine Scope Resolution

If `plantId`, `lineId`, or `lineName` is present:

```text
Machine.findAll({ attributes: ["id"] })
```

The resulting machine IDs are applied to `OperationLogs.machine_id`.

### Step 4: Anchor OperationLog Query

Builds `baseWhere` with:

```text
createdAt between safeFrom and safeTo
machine_id when scoped
operation_no when provided
user_id when provided
part_id OR LIKE values when barcode provided
station_no / operation_no when station provided
```

Runs:

```text
OperationLog.findAll({
  where: baseWhere,
  include: Machine(machine_name, line_name, operation_no),
  order: createdAt DESC,
  raw: true,
  nest: true,
  limit: maxBaseLogs only in fast mode
})
```

Then filters in JavaScript:

```text
logs.filter(isProductionReportLog)
```

### Step 5: Shift Filtering

If `shiftCode` exists:

1. `Shift.findAll({ is_active: true })`
2. JavaScript filters rows by shift window using row timestamps.

### Step 6: Part Status Fallback

If no anchor part IDs are found and no station scope exists:

Queries:

```text
Part.findAll({
  where: updatedAt between safeFrom and safeTo,
  attributes: part_id, qr_format_name, status, createdAt, updatedAt,
  order: updatedAt DESC,
  limit: 5000
})
```

Then optionally:

```text
PartCodeMapping.findAll({
  where: old_part_id IN partIds OR customer_qr IN partIds,
  is_active: true
})
```

Returns synthetic report rows from `Parts`.

### Step 7: Anchor Part List

Builds unique `anchorPartIds` from production logs.

In fast mode:

```text
anchorPartIds = allAnchorPartIds.slice(0, maxAnchorParts)
```

### Step 8: Full History OperationLog Query

Queries full operation history for anchor parts:

```text
OperationLog.findAll({
  where: { part_id: { IN anchorPartIds } },
  include: Machine(machine_name, line_name, operation_no),
  order: createdAt DESC,
  raw: true,
  nest: true
})
```

Then filters in JavaScript:

```text
fullHistoryLogs.filter(isProductionReportLog)
```

### Step 9: Part and Customer QR Lookup

Queries:

```text
Part.findAll({
  where: { part_id: { IN anchorPartIds } },
  attributes: part_id, qr_format_name, status
})
```

```text
PartCodeMapping.findAll({
  where: old_part_id IN anchorPartIds OR customer_qr IN anchorPartIds,
  is_active: true
})
```

Builds:

```text
partMap
partCodeMap
oldPartMap
```

### Step 10: Leaktest Index

If `includeLeaktest` is true:

1. Query active machines by optional plant/line scope.
2. `buildLeaktestIndex({ partIds, customerQrByPartId, machines })`.

If false, uses empty maps.

### Step 11: QR Rules

Queries:

```text
QrFormatRule.findAll({ attributes: ["format_name", "model_code"] })
```

Builds `qrMap`.

### Step 12: Deduplicate Full Production History

For each `(part_id, operation_no/station_no)`:

1. Prefer `ENDED_OK`.
2. Then prefer `ENDED_NG`.
3. Then prefer most recent.

Sorts deduplicated logs by latest anchor scan time, then by row `createdAt`.

### Step 13: PLC Reading Column Discovery

If `includePlcReadings` is true:

```sql
SELECT LOWER(COLUMN_NAME) AS column_name
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'PlcCycleReadings'
```

### Step 14: PLC Reading Lookup by Part ID Columns

If a part-ID style column exists:

For each part ID:

```sql
SELECT TOP 1 <PLC_REPORT_SELECT>
FROM PlcCycleReadings
WHERE [detected_column] = :value
ORDER BY recorded_at DESC
```

This is done by `fetchLatestPlcReadingsByColumn`.

### Step 15: PLC Reading Lookup by shot_uid

If `shot_uid` exists:

For each part ID:

```sql
SELECT TOP 1 <PLC_REPORT_SELECT>
FROM PlcCycleReadings
WHERE [shot_uid] = :value
ORDER BY recorded_at DESC
```

### Step 16: PLC Reading Lookup by Compact QR

For each parsed compact QR:

```sql
SELECT TOP 1 <PLC_REPORT_SELECT>
FROM PlcCycleReadings
WHERE TRY_CONVERT(INT, shot_day) = :day
  AND TRY_CONVERT(INT, shot_month) = :month
  AND TRY_CONVERT(INT, shot_hour) = :hour
  AND TRY_CONVERT(INT, shot_minute) = :minute
  AND (
    TRY_CONVERT(INT, shot_number) = :shot
    OR LTRIM(RTRIM(CAST(shot_number AS NVARCHAR(255)))) = :shotRaw
  )
ORDER BY recorded_at DESC
```

### Step 17: PLC Reading Lookup by Shot Tokens

For all shot candidates:

```sql
SELECT <PLC_REPORT_SELECT>
FROM PlcCycleReadings
WHERE CAST(shot_number AS NVARCHAR(255)) IN (...)
ORDER BY recorded_at DESC
```

The first row per normalized shot token is kept.

### Step 18: Per-Row Fallback PLC Lookup

During enrichment, if no PLC row was found from the maps:

```sql
SELECT TOP 1 <PLC_REPORT_SELECT>
FROM PlcCycleReadings
WHERE (
  TRY_CONVERT(INT, shot_number) = TRY_CONVERT(INT, :shot)
  OR LTRIM(RTRIM(CAST(shot_number AS NVARCHAR(255)))) = :shot
)
AND LTRIM(RTRIM(CAST(machine_name AS NVARCHAR(255)))) = :machineName
AND ABS(DATEDIFF(MINUTE, recorded_at, :logCreatedAt)) <= 15
ORDER BY
  ABS(DATEDIFF(SECOND, recorded_at, :logCreatedAt)) ASC,
  recorded_at DESC
```

This occurs inside `Promise.all(deduplicatedLogs.map(...))`.

### Step 19: Enrichment

Each deduplicated log is enriched with:

```text
display part ID
customer QR
machine / line / operation
model code
cycle start/end/time
industrial result
rejection fields
PLC reading
leaktest reading
report group key
```

### Step 20: In-Memory Report Pagination

After `fetchProductionData` returns:

1. `paginateReportRowsByPart` groups by `reportGroupKey`.
2. Groups are sorted by latest anchor timestamp.
3. Current page groups are sliced.
4. Rows from selected groups are flattened.

This preserves existing response shape, but means DB work is not limited by page size in full mode.

## PLC Summary Query

`fetchPlcShotSummary(filters)` runs separately from row enrichment.

It builds `WHERE` clauses on:

```text
recorded_at
plant/line/machine scope via LinePartAssignment or Machines
barcode/customerCode
partName
dieName
shiftCode
```

Core SQL:

```sql
WITH DistinctShots AS (
  SELECT shot_status,
         ROW_NUMBER() OVER(
           PARTITION BY machine_name, plc_ip, shot_number
           ORDER BY recorded_at DESC
         ) AS rn
  FROM PlcCycleReadings
  WHERE ...
)
SELECT shot_status, COUNT(*) AS count
FROM DistinctShots
WHERE rn = 1
GROUP BY shot_status
```

## Primary Phase 3 Refactor Constraints

Any pagination refactor must preserve:

1. Full-report metrics accuracy.
2. Group-by-part pagination semantics.
3. Deduplication priority.
4. Customer QR mapping behavior.
5. PLC reading fallback priority.
6. Leaktest enrichment behavior.
7. Existing response field names and values.
