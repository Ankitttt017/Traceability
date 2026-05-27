const net = require('net');

async function runTests() {
  const SERVER_HOST = '127.0.0.1';
  const SERVER_PORT = 5000;
  
  const tests = [
    { name: 'SC-01: Simple ID', payload: 'TEST-PART-001\n', expected: 'ALLOW' },
    { name: 'SC-02: Fragmented Packet', payload: ['PART-FRAG', '-002\n'], expected: 'ALLOW' },
    { name: 'SC-05: Fragmented Delayed', payload: ['PART-DELAY', '-003\n'], delay: 100, expected: 'ALLOW' },
    { name: 'SC-03: RESULT:FAIL', payload: 'TEST-PART-004|RESULT:NG\n', expected: 'BLOCK' }
  ];

  console.log('🚀 Starting Scanner Simulation Tests...');

  for (const t of tests) {
    try {
      const result = await sendPayload(SERVER_HOST, SERVER_PORT, t);
      const passed = result.includes(t.expected);
      console.log(`${passed ? '✅' : '❌'} ${t.name}: Expected ${t.expected}, Got ${result.trim()}`);
    } catch (err) {
      console.log(`❌ ${t.name} Failed: ${err.message}`);
    }
  }
}

function sendPayload(host, port, test) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let response = '';

    client.connect(port, host, () => {
      if (Array.isArray(test.payload)) {
        client.write(test.payload[0]);
        setTimeout(() => {
          client.write(test.payload[1]);
        }, test.delay || 0);
      } else {
        client.write(test.payload);
      }
    });

    client.on('data', (data) => {
      response += data.toString();
      if (response.includes('\n')) {
        client.destroy();
        resolve(response);
      }
    });

    client.on('error', reject);
    setTimeout(() => { client.destroy(); reject(new Error('Timeout')); }, 2000);
  });
}

runTests();
