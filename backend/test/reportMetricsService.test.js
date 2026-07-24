const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateProductionMetrics } = require("../services/report/reportMetricsService");

test("production metrics count carry-over NG by final result time, not total production", () => {
  const metrics = calculateProductionMetrics([
    {
      partId: "PART-1",
      operationNo: "OP110",
      industrialResult: "OK",
      firstScanCreatedAt: "2026-07-16T23:50:00.000Z",
      createdAt: "2026-07-16T23:50:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T06:20:00.000Z",
    },
    {
      partId: "PART-1",
      operationNo: "OP120",
      industrialResult: "NG",
      createdAt: "2026-07-17T06:20:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T06:20:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.traceabilityProduction, 0);
  assert.equal(metrics.totalProduction, 0);
  assert.equal(metrics.totalNG, 1);
  assert.equal(metrics.totalOK, 0);
  assert.equal(metrics.inProgress, 0);
});

test("production metrics count carry-over OK by final result time, not total production", () => {
  const metrics = calculateProductionMetrics([
    {
      partId: "PART-OK-CARRY",
      operationNo: "OP110",
      industrialResult: "OK",
      firstScanCreatedAt: "2026-07-16T23:50:00.000Z",
      createdAt: "2026-07-16T23:50:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T06:20:00.000Z",
    },
    {
      partId: "PART-OK-CARRY",
      operationNo: "OP120",
      industrialResult: "OK",
      firstScanCreatedAt: "2026-07-16T23:50:00.000Z",
      createdAt: "2026-07-17T06:20:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T06:20:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.traceabilityProduction, 0);
  assert.equal(metrics.totalProduction, 0);
  assert.equal(metrics.totalOK, 1);
  assert.equal(metrics.totalNG, 0);
  assert.equal(metrics.inProgress, 0);
});

test("production metrics classify first-scanned parts by final result in the selected window", () => {
  const metrics = calculateProductionMetrics([
    {
      partId: "PART-1",
      operationNo: "OP110",
      industrialResult: "OK",
      firstScanCreatedAt: "2026-07-17T06:10:00.000Z",
      createdAt: "2026-07-17T06:10:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T06:20:00.000Z",
    },
    {
      partId: "PART-1",
      operationNo: "OP120",
      industrialResult: "NG",
      firstScanCreatedAt: "2026-07-17T06:10:00.000Z",
      createdAt: "2026-07-17T06:20:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T06:20:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.traceabilityProduction, 1);
  assert.equal(metrics.totalProduction, 1);
  assert.equal(metrics.totalNG, 1);
  assert.equal(metrics.totalOK, 0);
  assert.equal(metrics.inProgress, 0);
});

test("production metrics do not count future final OK in an earlier production window", () => {
  const metrics = calculateProductionMetrics([
    {
      partId: "PART-2",
      operationNo: "OP110",
      industrialResult: "OK",
      createdAt: "2026-07-17T10:00:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:00:00.000Z",
    },
    {
      partId: "PART-2",
      operationNo: "OP120",
      industrialResult: "OK",
      createdAt: "2026-07-18T08:00:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:00:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.traceabilityProduction, 1);
  assert.equal(metrics.totalProduction, 1);
  assert.equal(metrics.totalOK, 0);
  assert.equal(metrics.totalNG, 0);
  assert.equal(metrics.inProgress, 1);
});

test("production metrics do not treat a single OK operation as final OK when part status is still open", () => {
  const metrics = calculateProductionMetrics([
    {
      partId: "PART-3",
      operationNo: "OP110",
      industrialResult: "OK",
      partStatus: "IN_PROGRESS",
      createdAt: "2026-07-17T10:00:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:00:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.totalProduction, 1);
  assert.equal(metrics.totalOK, 0);
  assert.equal(metrics.totalNG, 0);
  assert.equal(metrics.inProgress, 1);
});

test("production metrics count final OK when part status is passed in the selected window", () => {
  const metrics = calculateProductionMetrics([
    {
      partId: "PART-4",
      operationNo: "OP110",
      industrialResult: "OK",
      partStatus: "OK",
      createdAt: "2026-07-17T10:00:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:00:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.totalProduction, 1);
  assert.equal(metrics.totalOK, 1);
  assert.equal(metrics.totalNG, 0);
  assert.equal(metrics.inProgress, 0);
});

test("production metrics count all required operations OK as final OK even when part status is not closed", () => {
  const metrics = calculateProductionMetrics([
    {
      partId: "PART-5",
      operationNo: "OP110",
      industrialResult: "OK",
      partStatus: "IN_PROGRESS",
      createdAt: "2026-07-17T10:00:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:05:00.000Z",
    },
    {
      partId: "PART-5",
      operationNo: "OP120",
      industrialResult: "OK",
      partStatus: "IN_PROGRESS",
      createdAt: "2026-07-17T10:05:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:05:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.totalProduction, 1);
  assert.equal(metrics.totalOK, 1);
  assert.equal(metrics.totalNG, 0);
  assert.equal(metrics.inProgress, 0);
});

test("production metrics count leak test OP150 NG as final NG", () => {
  const metrics = calculateProductionMetrics([
    {
      partId: "PART-6",
      operationNo: "OP110",
      industrialResult: "OK",
      createdAt: "2026-07-17T10:00:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:10:00.000Z",
    },
    {
      partId: "PART-6",
      operationNo: "OP150",
      industrialResult: "NG",
      createdAt: "2026-07-17T10:10:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:10:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.totalProduction, 1);
  assert.equal(metrics.totalOK, 0);
  assert.equal(metrics.totalNG, 1);
  assert.equal(metrics.inProgress, 0);
});

test("production metrics do not duplicate customer QR and internal part rows", () => {
  const metrics = calculateProductionMetrics([
    {
      reportGroupKey: "PART-7",
      partId: "PART-7",
      operationNo: "OP110",
      industrialResult: "OK",
      firstScanCreatedAt: "2026-07-17T10:00:00.000Z",
      createdAt: "2026-07-17T10:00:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:05:00.000Z",
    },
    {
      reportGroupKey: "PART-7",
      partId: "R-CUSTOMER-QR-7",
      operationNo: "OP120",
      industrialResult: "OK",
      firstScanCreatedAt: "2026-07-17T10:00:00.000Z",
      createdAt: "2026-07-17T10:05:00.000Z",
      latestAnchorCreatedAt: "2026-07-17T10:05:00.000Z",
    },
  ], {
    dateFrom: "2026-07-17T00:00:00.000Z",
    dateTo: "2026-07-17T23:59:59.999Z",
  });

  assert.equal(metrics.traceabilityProduction, 1);
  assert.equal(metrics.totalProduction, 1);
  assert.equal(metrics.totalOK, 1);
  assert.equal(metrics.totalNG, 0);
  assert.equal(metrics.inProgress, 0);
});
