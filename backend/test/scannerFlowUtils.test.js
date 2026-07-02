const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeScannerPayload,
  buildScannerDisplayContext,
  validateScannerPayload,
} = require('../tcp/scannerFlowUtils');

test('sanitizeScannerPayload strips control characters without losing valid QR content', () => {
  assert.equal(sanitizeScannerPayload('\u0000CUS123\n'), 'CUS123');
  assert.equal(sanitizeScannerPayload('   '), '');
});

test('buildScannerDisplayContext preserves the original scanned QR and mapped part separately', () => {
  const context = buildScannerDisplayContext({
    rawPayload: 'CUS987654321',
    partId: 'PART0002456',
    customerQrCode: 'CUS987654321',
    mappedPartId: 'PART0002456',
  });

  assert.equal(context.scannedQr, 'CUS987654321');
  assert.equal(context.customerQrCode, 'CUS987654321');
  assert.equal(context.mappedPartId, 'PART0002456');
  assert.equal(context.displayQr, 'CUS987654321');
});

test('validateScannerPayload no longer rejects short but valid QR payloads', () => {
  const result = validateScannerPayload({ payload: 'A1', scannerRole: 'CUSTOMER_QR' });
  assert.equal(result.isValid, true);
  assert.equal(result.sanitizedPayload, 'A1');
});
