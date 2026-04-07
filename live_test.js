const BASE_URL = 'http://localhost:4000/api';
const AUTH_URL = 'http://localhost:4000/api/auth/login';

async function testProject() {
  console.log('--- STARTING LIVE PROJECT TESTING ---');
  let token = '';

  // 1. Authentication
  try {
    const authRes = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const authData = await authRes.json();
    if (authRes.ok && authData.token) {
      token = authData.token;
      console.log('[PASS] Authentication: Login successful');
    } else {
      console.log('[FAIL] Authentication: Login failed', authData);
      return;
    }
  } catch (e) {
    console.log('[FAIL] Authentication: Error during login', e.message);
    return;
  }

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 2. Dashboard Data
  try {
    const dashRes = await fetch(`${BASE_URL}/v1/dashboard/summary`, { headers });
    if (dashRes.ok) {
      const data = await dashRes.json();
      console.log('[PASS] Dashboard: Data retrieved successfully', data);
    } else {
      console.log('[FAIL] Dashboard: Failed to retrieve data', dashRes.status);
    }
  } catch (e) {
    console.log('[FAIL] Dashboard: Error', e.message);
  }

  // 3. Traceability
  try {
    const partId = 'IND-ACT-2601-001';
    const traceRes = await fetch(`${BASE_URL}/v1/traceability/${partId}`, { headers });
    if (traceRes.ok) {
        const data = await traceRes.json();
        console.log('[PASS] Traceability: Part trace retrieved', data);
    } else {
        console.log('[FAIL] Traceability: Part trace failed', traceRes.status);
    }
  } catch (e) {
    console.log('[FAIL] Traceability: Error', e.message);
  }

  // 4. Device Management (Machine Add)
  let testMachineId = null;
  try {
    const machineRes = await fetch(`${BASE_URL}/v1/machines`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'LiveTestMachine', ip: '192.168.1.50', protocol: 'SLMP', plcPort: 5000 })
    });
    const data = await machineRes.json();
    if (machineRes.status === 201 || machineRes.status === 200) {
      testMachineId = data.id;
      console.log('[PASS] Device Management: Machine added successfully', data);
    } else {
      console.log('[FAIL] Device Management: Machine add failed', data);
    }
  } catch (e) {
    console.log('[FAIL] Device Management: Error adding machine', e.message);
  }

  // 5. Machine Cleanup
  if (testMachineId) {
    try {
      const delRes = await fetch(`${BASE_URL}/v1/machines/${testMachineId}`, {
        method: 'DELETE',
        headers
      });
      if (delRes.ok) {
        console.log('[PASS] Device Management: Machine deleted successfully');
      } else {
        console.log('[FAIL] Device Management: Machine delete failed', delRes.status);
      }
    } catch (e) {
      console.log('[FAIL] Device Management: Error deleting machine', e.message);
    }
  }

  // 6. I/O Monitor Snapshot
  try {
    const ioRes = await fetch(`${BASE_URL}/v1/traceability/io-snapshot`, { headers });
    if (ioRes.ok) {
      console.log('[PASS] I/O Monitor: Snapshot retrieved');
    } else {
      console.log('[FAIL] I/O Monitor: Failed', ioRes.status);
    }
  } catch (e) {
    console.log('[FAIL] I/O Monitor: Error', e.message);
  }

  console.log('--- LIVE PROJECT TESTING COMPLETED ---');
}

testProject();
