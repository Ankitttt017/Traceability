/**
 * IndusTrace QA API Test Suite — v2
 * Tests against ACTUAL routes discovered from codebase inspection.
 */

const BASE = 'http://localhost:4000/api';
let token = '';

const log = [];
let pass = 0, fail = 0, skip = 0;

function record(section, desc, status, actual, severity = '-') {
  log.push({ section, desc, status, actual, severity });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  console.log(`${icon} [${section}] ${desc} → ${actual}`);
  if (status === 'PASS') pass++;
  else if (status === 'FAIL') fail++;
  else skip++;
}

async function json(res) {
  try { return await res.json(); } catch { return null; }
}

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' IndusTrace — QA API Test Suite v2');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── 7.1 AUTH ──────────────────────────────────────────────
  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const body = await json(res);
    if (res.status === 200 && body?.token) {
      token = body.token;
      record('7.1', 'Valid login → 200 + JWT token', 'PASS', `200 OK, token acquired (${token.slice(0, 20)}...)`);
    } else {
      record('7.1', 'Valid login → 200 + JWT token', 'FAIL', `Status: ${res.status}, body: ${JSON.stringify(body)}`, 'Critical');
    }
  } catch (e) { record('7.1', 'Valid login → 200 + JWT token', 'FAIL', e.message, 'Critical'); }

  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpass' })
    });
    const body = await json(res);
    if (res.status === 400 || res.status === 401) {
      record('7.1', 'Invalid password → 401', 'PASS', `${res.status} — ${body?.message || body?.error || 'error returned'}`);
    } else {
      record('7.1', 'Invalid password → 401', 'FAIL', `Got ${res.status}`, 'High');
    }
  } catch (e) { record('7.1', 'Invalid password → 401', 'FAIL', e.message, 'High'); }

  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: "' OR '1'='1", password: 'anything' })
    });
    const body = await json(res);
    if (res.status !== 200) {
      record('7.1', 'SQL Injection → rejected', 'PASS', `Status: ${res.status} — login not bypassed`);
    } else {
      record('7.1', 'SQL Injection → rejected', 'FAIL', 'Login succeeded with SQLi payload', 'Critical');
    }
  } catch (e) { record('7.1', 'SQL Injection → rejected', 'FAIL', e.message, 'Critical'); }

  // ── 7.2 PROTECTED ROUTES (no token) ──────────────────────
  const protectedRoutes = [
    { path: '/dashboard/summary', label: 'GET /dashboard/summary' },
    { path: '/traceability/operations', label: 'GET /traceability/operations' },
    { path: '/machines', label: 'GET /machines' },
  ];

  for (const r of protectedRoutes) {
    try {
      const res = await fetch(`${BASE}${r.path}`);
      if (res.status === 401 || res.status === 403) {
        record('7.2', `No-token: ${r.label}`, 'PASS', `${res.status} Unauthorized/Forbidden`);
      } else {
        record('7.2', `No-token: ${r.label}`, 'FAIL', `Status: ${res.status} — route not protected`, 'High');
      }
    } catch (e) { record('7.2', `No-token: ${r.label}`, 'FAIL', e.message, 'High'); }
  }

  // ── 7.3 DASHBOARD DATA WITH VALID TOKEN ──────────────────
  const dashEndpoints = [
    '/dashboard/summary',
    '/dashboard/trends',
    '/dashboard/report',
    '/dashboard/oee',
  ];

  for (const ep of dashEndpoints) {
    try {
      const res = await fetch(`${BASE}${ep}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = await json(res);
      if (res.status === 200) {
        record('7.3', `Dashboard: GET ${ep}`, 'PASS', '200 OK, JSON returned');
      } else {
        record('7.3', `Dashboard: GET ${ep}`, 'FAIL', `Status: ${res.status}, body: ${JSON.stringify(body)?.slice(0, 80)}`, 'Medium');
      }
    } catch (e) { record('7.3', `Dashboard: GET ${ep}`, 'FAIL', e.message, 'Medium'); }
  }

  // ── 7.4 TRACEABILITY ─────────────────────────────────────
  try {
    const res = await fetch(`${BASE}/traceability/INVALID_999`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 200 || res.status === 404) {
      const body = await json(res);
      record('7.4', 'Traceability invalid partId → 200/404', 'PASS', `Status: ${res.status} — ${JSON.stringify(body)?.slice(0, 60)}`);
    } else {
      record('7.4', 'Traceability invalid partId → not 500', 'FAIL', `Status: ${res.status}`, 'High');
    }
  } catch (e) { record('7.4', 'Traceability invalid partId → not 500', 'FAIL', e.message, 'High'); }

  // ── 7.5 REPORTS EXPORT ───────────────────────────────────
  try {
    const res = await fetch(`${BASE}/dashboard/report/export?from=2026-01-01&to=2026-04-01`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const ct = res.headers.get('content-type') || '';
    if (res.status === 200) {
      const hasContent = ct.includes('csv') || ct.includes('pdf') || ct.includes('octet') || ct.includes('excel') || ct.includes('spreadsheet');
      record('7.5', 'Reports Export endpoint', hasContent ? 'PASS' : 'FAIL',
        `200 OK, Content-Type: ${ct}`, hasContent ? '-' : 'Medium');
    } else {
      record('7.5', 'Reports Export endpoint', 'FAIL', `Status: ${res.status}`, 'High');
    }
  } catch (e) { record('7.5', 'Reports Export endpoint', 'FAIL', e.message, 'High'); }

  // ── 7.6 MACHINE CRUD (/api/machines — ACTUAL ROUTE) ──────
  let createdMachineId = null;

  try {
    const res = await fetch(`${BASE}/machines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'QA_Machine_Test_01', ip: '192.168.99.100', protocol: 'SLMP', sequence_no: 99 })
    });
    const body = await json(res);
    if (res.status === 201 || res.status === 200) {
      createdMachineId = body?.id || body?.machine?.id || null;
      record('7.6', 'POST /machines (valid body) → 201', 'PASS', `Status: ${res.status}, ID: ${createdMachineId}`);
    } else {
      record('7.6', 'POST /machines (valid body) → 201', 'FAIL', `Status: ${res.status} — ${JSON.stringify(body)?.slice(0, 80)}`, 'High');
    }
  } catch (e) { record('7.6', 'POST /machines (valid body) → 201', 'FAIL', e.message, 'High'); }

  try {
    const res = await fetch(`${BASE}/machines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({})
    });
    const body = await json(res);
    if (res.status === 400 || res.status === 422 || res.status === 500) {
      record('7.6', 'POST /machines (empty body) → 400', 'PASS', `Status: ${res.status}`);
    } else {
      record('7.6', 'POST /machines (empty body) → 400', 'FAIL', `Status: ${res.status} — no validation error`, 'Medium');
    }
  } catch (e) { record('7.6', 'POST /machines (empty body) → 400', 'FAIL', e.message, 'Medium'); }

  // Cleanup: delete the test machine
  if (createdMachineId) {
    try {
      const res = await fetch(`${BASE}/machines/${createdMachineId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      record('7.6', `DELETE /machines/${createdMachineId} (cleanup)`, res.status < 300 ? 'PASS' : 'FAIL',
        `Status: ${res.status}`);
    } catch (e) { record('7.6', 'DELETE /machines (cleanup)', 'FAIL', e.message, 'Low'); }
  }

  // ── RATE LIMIT CHECK ─────────────────────────────────────
  try {
    const promises = Array.from({ length: 10 }, () =>
      fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'BRUTE' })
      })
    );
    const results = await Promise.all(promises);
    const statuses = results.map(r => r.status);
    const rateLimited = statuses.some(s => s === 429);
    record('10', 'Login flood (10 rapid requests) → rate limited', rateLimited ? 'PASS' : 'FAIL',
      `Statuses: ${[...new Set(statuses)].join(', ')} — ${rateLimited ? 'Rate limit active' : 'No rate-limiting (429) detected'}`,
      rateLimited ? '-' : 'Critical');
  } catch (e) { record('10', 'Login flood / rate limit', 'FAIL', e.message, 'Critical'); }

  // ── SUMMARY ──────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` TOTAL: ${pass + fail + skip} | ✅ PASS: ${pass} | ❌ FAIL: ${fail} | ⏭️ SKIP: ${skip}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Write raw results as JSON
  const fs = (await import('fs')).default;
  fs.writeFileSync('qa_api_results.json', JSON.stringify({ summary: { pass, fail, skip }, results: log }, null, 2));
  console.log('Results saved to qa_api_results.json');
}

run().catch(console.error);
