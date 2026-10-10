// SCANNER-FIX: routing tests for the OP110 laser flow.
// The DB is pointed at a closed local port BEFORE anything is required, and
// every model method used by the code under test is stubbed, so this test can
// never read or write a real database.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';
process.env.DB_NAME = 'unit_test_no_db';
process.env.DB_INSTANCE = '';
process.env.DB_CONNECT_TIMEOUT_MS = '500';
process.env.DB_RETRY_MAX = '0';
process.env.TCP_SERVER_PORT = '';

const test = require('node:test');
const assert = require('node:assert/strict');

const Part = require('../models/Part');
const PartCodeMapping = require('../models/PartCodeMapping');
const OperationLog = require('../models/OperationLog');
const Machine = require('../models/Machine');
const stationFeatureService = require('../services/stationFeatureService');

// --- stubs -----------------------------------------------------------------
const db = { parts: new Set(), mappings: [] };
Part.findOne = async ({ where }) => (db.parts.has(where.part_id) ? { part_id: where.part_id, qr_format_name: 'DPM QR Code' } : null);
PartCodeMapping.findOne = async ({ where }) => {
  const match = db.mappings.find((row) => (
    (where.customer_qr === undefined || row.customer_qr === where.customer_qr) &&
    (where.old_part_id === undefined || row.old_part_id === where.old_part_id)
  ));
  return match || null;
};
PartCodeMapping.findAll = async () => [];
OperationLog.findOne = async () => null;
OperationLog.findAll = async () => [];
Machine.findAll = async () => [{ id: 3, operation_no: 'OP110', machine_name: 'Laser Marking', machine_type: 'LASER' }];
stationFeatureService.getStationFeatureConfig = async () => ({
  customerQrRequiredConfigured: true,
  customerQrRequired: true,
  allowCustomerQrOnlyStart: true,
});

const { _internals } = require('../tcp/tcpServer');
const {
  buildWorkflowKey,
  beginWorkflow,
  resetWorkflowState,
} = require('../services/laserMarkingWorkflowService');

const machine = { id: 3, operation_no: 'OP110', machine_name: 'Laser Marking', machine_type: 'LASER' };
const KEY = buildWorkflowKey(3, 'OP110');

test('START_QR (DPM scanner) read while a part is waiting never becomes a customer QR', async () => {
  resetWorkflowState(KEY, { reason: 'TEST' });
  beginWorkflow(KEY, { machineId: 3, stationNo: 'OP110', partId: '1009090124135' });
  db.parts.add('1009090124135');

  // second DPM read of a different (new) part from the DPM scanner
  const secondDpm = await _internals.resolveScannerFlow({
    code: '1005181520436', stationNo: 'OP110', machine, qrType: 'START_QR', scannerRole: 'START_QR',
  });
  assert.notEqual(secondDpm.flowType, 'CUSTOMER_QR');
  assert.equal(secondDpm.flowType, 'NORMAL');
  assert.equal(secondDpm.qrType, 'START_QR');

  // even a customer-QR-shaped read from the DPM scanner is not routed as customer QR
  const customerOnDpm = await _internals.resolveScannerFlow({
    code: 'R437111511-54T00011026A0005', stationNo: 'OP110', machine, qrType: 'START_QR', scannerRole: 'START_QR',
  });
  assert.notEqual(customerOnDpm.flowType, 'CUSTOMER_QR');
  resetWorkflowState(KEY, { reason: 'TEST' });
});

test('customer QR from the customer scanner maps to the waiting part', async () => {
  resetWorkflowState(KEY, { reason: 'TEST' });
  beginWorkflow(KEY, { machineId: 3, stationNo: 'OP110', partId: '1009090124135' });
  const flow = await _internals.resolveScannerFlow({
    code: 'R437111511-54T00011026A0005', stationNo: 'OP110', machine, qrType: 'CUSTOMER_QR', scannerRole: 'CUSTOMER_QR',
  });
  assert.equal(flow.flowType, 'CUSTOMER_QR');
  const active = await _internals.resolveActivePartForMachine(machine, 'OP110');
  assert.deepEqual(active, { partId: '1009090124135', source: 'MEMORY' });
  resetWorkflowState(KEY, { reason: 'TEST' });
});

test('no waiting part → no 60-min DB fallback (default off)', async () => {
  resetWorkflowState(KEY, { reason: 'TEST' });
  let queried = false;
  const original = OperationLog.findAll;
  OperationLog.findAll = async () => { queried = true; return [{ part_id: '1009090124135', plc_status: 'PENDING', createdAt: new Date() }]; };
  try {
    const active = await _internals.resolveActivePartForMachine(machine, 'OP110');
    assert.deepEqual(active, { partId: '', source: null });
    assert.equal(queried, false);
  } finally {
    OperationLog.findAll = original;
  }
});

test('a DPM part id can never start a customer-QR-only part', async () => {
  assert.equal(await _internals.canStartCustomerQrOnlyPart({ code: '1009090124135', stationNo: 'OP110', machine }), false);
  assert.equal(await _internals.canStartCustomerQrOnlyPart({ code: 'ERRORERROR', stationNo: 'OP110', machine }), false);
  assert.equal(await _internals.canStartCustomerQrOnlyPart({ code: 'R437111511-54T00099926C0001', stationNo: 'OP110', machine }), true);
});

test('validation role comes from the real scanner rows', () => {
  assert.equal(_internals.resolveValidationRoleForScanners([{ scanner_role: 'START_QR' }]), 'START_QR');
  assert.equal(_internals.resolveValidationRoleForScanners([{ scanner_role: 'CUSTOMER_QR' }]), 'CUSTOMER_QR');
  assert.equal(_internals.resolveValidationRoleForScanners([{ scanner_role: null }]), 'UNKNOWN');
  assert.equal(_internals.resolveValidationRoleForScanners([{ scanner_role: 'START_QR' }, { scanner_role: 'CUSTOMER_QR' }]), 'UNKNOWN');
});

test.after(async () => {
  // close the (never connected) pool so the test process exits
  await require('../config/db').close().catch(() => {});
});
