process.env.NODE_ENV = 'test';
const { saveScan } = require('../services/scanService');
const Machine = require('../models/Machine');
const Part = require('../models/Part');
const OperationLog = require('../models/OperationLog');
const sequelize = require('../config/db');

async function runSequenceTests() {
  await sequelize.sync({ force: true });

  console.log('🧪 Starting Station Sequence Verification...');

  // 1. Setup Mock Stations
  await Machine.create({ machine_number: 'M10', line_name: 'LINE-1', machine_name: 'ST-10', operation_no: 'ST-10', sequence_no: 10, is_active: true, machine_ip: '127.0.0.1' });
  await Machine.create({ machine_number: 'M20', line_name: 'LINE-1', machine_name: 'ST-20', operation_no: 'ST-20', sequence_no: 20, is_active: true, machine_ip: '127.0.0.1' });
  await Machine.create({ machine_number: 'M30', line_name: 'LINE-1', machine_name: 'ST-30', operation_no: 'ST-30', sequence_no: 30, is_active: true, machine_ip: '127.0.0.1' });

  const partId = 'TEST-PART-001';

  try {
    // SEQ-01: First Station
    console.log('\nStep 1: Scanning at ST-10...');
    const res1 = await saveScan(partId, 'ST-10', 'OK', 1);
    assert(res1.decision === 'ALLOW', 'ST-10 should be ALLOWED');
    
    // Simulate PLC End OK
    const part = await Part.findOne({ where: { part_id: partId } });
    part.current_station = 'ST-10';
    part.status = 'IN_PROGRESS';
    await part.save();

    // SEQ-02: Sequence Violation (ST-30 skip ST-20)
    console.log('Step 2: Attempting skip to ST-30 (should BLOCK)...');
    const res2 = await saveScan(partId, 'ST-30', 'OK', 3);
    assert(res2.decision === 'BLOCK' && res2.reason === 'PREVIOUS_STATION_NOT_COMPLETED', 'ST-30 skip should be BLOCKED');

    // SEQ-03: Correct Sequence (ST-20)
    console.log('Step 3: Scanning at ST-20...');
    const res3 = await saveScan(partId, 'ST-20', 'OK', 2);
    assert(res3.decision === 'ALLOW', 'ST-20 should be ALLOWED');

    // Simulate Interlock at ST-20
    const opLog = await OperationLog.findOne({ where: { part_id: partId, station_no: 'ST-20' } });
    await opLog.update({ plc_status: 'ENDED_NG' });
    await part.update({ status: 'INTERLOCKED', current_operation: 'ST-20', is_interlocked: true });

    // SEQ-04: Interlock Re-scan (Allowed by Rule DSC-001)
    console.log('Step 4: Attempting Interlock Recovery Scan at ST-20...');
    const res4 = await saveScan(partId, 'ST-20', 'OK', 2);
    assert(res4.decision === 'ALLOW', 'ST-20 Recovery scan should be ALLOWED');
    
    const updatedLog = await OperationLog.findOne({ where: { part_id: partId, station_no: 'ST-20' } });
    assert(updatedLog.plc_status === 'RETRY', 'OperationLog should be marked as RETRY');

    console.log('\n✅ ALL SEQUENCE TESTS PASSED');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  OK: ${message}`);
}

runSequenceTests();
