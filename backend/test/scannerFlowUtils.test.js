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

test('sanitizeScannerPayload collapses repeated scanner payloads from duplicate TCP frames', () => {
  const customerQr = 'R437111511-54T00150726A0288';
  assert.equal(sanitizeScannerPayload(`${customerQr}${customerQr}`), customerQr);
  assert.equal(sanitizeScannerPayload(`${customerQr}${customerQr}${customerQr}`), customerQr);
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

test('validateScannerPayload accepts printable customer QR payloads outside ASCII', () => {
  const result = validateScannerPayload({ payload: 'CUS-ग्राहक-123', scannerRole: 'CUSTOMER_QR' });
  assert.equal(result.isValid, true);
  assert.equal(result.reason, null);
});
