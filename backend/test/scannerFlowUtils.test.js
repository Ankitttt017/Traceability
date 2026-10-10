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

test('validateScannerPayload rejects payloads shorter than the minimum QR length', () => {
  // 1–3 character frames are scanner noise, never a real part ID or customer QR (minimum 4)
  const result = validateScannerPayload({ payload: 'A1', scannerRole: 'CUSTOMER_QR' });
  assert.equal(result.isValid, false);
});

test('validateScannerPayload accepts printable customer QR payloads outside ASCII', () => {
  // SCANNER-FIX: the CUSTOMER_QR role now enforces the customer-QR format; the
  // generic printable-character rule is still exercised for untyped scanners.
  const result = validateScannerPayload({ payload: 'CUS-ग्राहक-123', scannerRole: 'GENERAL' });
  assert.equal(result.isValid, true);
  assert.equal(result.reason, null);
});

// ---------------------------------------------------------------------------
// SCANNER-FIX tests (OP110 framing / validation). Real codes from production.
// ---------------------------------------------------------------------------
const {
  splitScannerFrames,
  isCompleteKnownCode,
  isDpmCode,
  isCustomerQrCode,
  setScannerFormatRules,
} = require('../tcp/scannerFlowUtils');

const REAL_DPM = ['1009090124135', '0816164128579', '1005181520436'];
const REAL_CUSTOMER_QR = [
  'R437111511-54T00011026A0005', // A series
  'R437111511-54T00030626B0003', // B series (plant rule sample)
  'R437111511-54T00071026C0877', // C series
];

test('framing: CR-only terminated reads are split into separate frames', () => {
  const { frames, rest } = splitScannerFrames('1009090124135\rR437111511-54T00011026A0005\r');
  assert.deepEqual(frames, ['1009090124135', 'R437111511-54T00011026A0005']);
  assert.equal(rest, '');
});

test('framing: LF, CRLF and NUL terminators all split; unterminated tail is kept', () => {
  const { frames, rest } = splitScannerFrames('A1234\r\nB5678\nC9012\u0000D34');
  assert.deepEqual(frames, ['A1234', 'B5678', 'C9012']);
  assert.equal(rest, 'D34');
});

test('framing: CRLF split across two TCP chunks does not produce an empty frame', () => {
  const first = splitScannerFrames('1009090124135\r');
  assert.deepEqual(first.frames, ['1009090124135']);
  const second = splitScannerFrames(`${first.rest}\n1005181520436\r`);
  assert.deepEqual(second.frames, ['1005181520436']);
});

test('framing: partial frame on socket close is only kept if it is a complete code', () => {
  assert.equal(isCompleteKnownCode('?V047'), false);
  assert.equal(isCompleteKnownCode('R437111511-54T0001'), false);
  assert.equal(isCompleteKnownCode('1009090124135'), true);
  assert.equal(isCompleteKnownCode('R437111511-54T00011026A0005\r'), true);
});

test('valid DPM codes are accepted on the START_QR (DPM) scanner', () => {
  for (const code of REAL_DPM) {
    const result = validateScannerPayload({ payload: code, scannerRole: 'START_QR' });
    assert.equal(result.isValid, true, code);
    assert.equal(result.qrKind, 'DPM');
  }
});

test('valid customer QRs (A/B/C series) are accepted on the CUSTOMER_QR scanner', () => {
  for (const code of REAL_CUSTOMER_QR) {
    const result = validateScannerPayload({ payload: code, scannerRole: 'CUSTOMER_QR' });
    assert.equal(result.isValid, true, code);
    assert.equal(result.qrKind, 'CUSTOMER');
  }
});

test('the plant "Customer QR Code" rule (B only) does not reject A/C labels (union)', () => {
  setScannerFormatRules([
    { format_name: 'DPM QR Code', regex_pattern: '^(?<month>\\d{2})(?<day>\\d{2})(?<hour>\\d{2})(?<minute>\\d{2})(?<machine_code>[A-Z0-9]{1})(?<shot>\\d{1,6})$', is_active: true },
    { format_name: 'Customer QR Code', regex_pattern: '^R\\d{9}-\\d{2}T\\d{8}B\\d{4}$', is_active: true },
  ]);
  try {
    for (const code of REAL_CUSTOMER_QR) assert.equal(isCustomerQrCode(code), true, code);
    for (const code of REAL_DPM) assert.equal(isDpmCode(code), true, code);
  } finally {
    setScannerFormatRules([]);
  }
});

test('glued ERROR payloads are rejected (status word anywhere)', () => {
  const glued = [
    'ERRORERRORERROR1007210822642',
    'ERROR1002002227260',
    'ERRORERROR1005143520268',
    '1003011627828ERROR',
    'ERRORERRORERRORERRORERROR',
    'ERRORERROR',
    'NOREAD',
  ];
  for (const payload of glued) {
    for (const role of ['START_QR', 'CUSTOMER_QR', 'UNKNOWN']) {
      const result = validateScannerPayload({ payload, scannerRole: role });
      assert.equal(result.isValid, false, `${payload} (${role})`);
      assert.equal(result.reason, 'QR_PAYLOAD_STATUS_TOKEN', `${payload} (${role})`);
    }
  }
});

test('concatenated QRs are rejected even without a separator', () => {
  const concatenated = [
    'R437111511-54T00011026B0155R437111511-54T00011026B0156',
    'R437111511-54T00011026B0150R437111511-54T00011026B0151R437111511-54T00011026B0152R437111511-54T00011026B0153',
    '10090901241351005181520436', // two DPMs glued
    'R437111511-54T00011026A00051009090124135', // customer QR + DPM
  ];
  for (const payload of concatenated) {
    for (const role of ['START_QR', 'CUSTOMER_QR', 'UNKNOWN']) {
      const result = validateScannerPayload({ payload, scannerRole: role });
      assert.equal(result.isValid, false, `${payload} (${role})`);
      assert.equal(result.reason, 'QR_MULTIPLE_VALUES', `${payload} (${role})`);
    }
  }
});

test('identical repeated reads still collapse to one valid code', () => {
  const result = validateScannerPayload({ payload: 'R437111511-54T00150726A0288R437111511-54T00150726A0288', scannerRole: 'CUSTOMER_QR' });
  assert.equal(result.isValid, true);
  assert.equal(result.sanitizedPayload, 'R437111511-54T00150726A0288');
});

test('fragments and wrong-scanner reads fail the role format check', () => {
  assert.equal(validateScannerPayload({ payload: '?V047', scannerRole: 'START_QR' }).isValid, false);
  assert.equal(validateScannerPayload({ payload: 'A0467', scannerRole: 'CUSTOMER_QR' }).isValid, false);
  // a customer QR read by the DPM scanner is not a DPM
  const onDpm = validateScannerPayload({ payload: 'R437111511-54T00011026A0005', scannerRole: 'START_QR' });
  assert.equal(onDpm.isValid, false);
  assert.equal(onDpm.reason, 'QR_ROLE_FORMAT_MISMATCH');
  // a DPM read by the customer scanner is a valid read (routing decides), qrKind=DPM
  const onCustomer = validateScannerPayload({ payload: '1009090124135', scannerRole: 'CUSTOMER_QR' });
  assert.equal(onCustomer.isValid, true);
  assert.equal(onCustomer.qrKind, 'DPM');
});

test('role format validation can be switched off by env', () => {
  process.env.SCANNER_ROLE_FORMAT_VALIDATION = 'off';
  try {
    assert.equal(validateScannerPayload({ payload: 'ABC123', scannerRole: 'START_QR' }).isValid, true);
  } finally {
    delete process.env.SCANNER_ROLE_FORMAT_VALIDATION;
  }
});
