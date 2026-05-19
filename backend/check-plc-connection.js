const { readSlmpRegisters, readModbusRegisters } = require('./services/plcIoService');

(async () => {
  const ip = '192.168.119.40';
  const port = 1025;
  const timeoutMs = 3000;

  console.log(`--- Testing SLMP Binary on ${ip}:${port} ---`);
  try {
    const res = await readSlmpRegisters({
      ip,
      port,
      registers: [{ register: 2250, device: 'D' }],
      timeoutMs,
      frameMode: 'BINARY'
    });
    console.log('SLMP BINARY Success:', res);
  } catch (e) {
    console.log('SLMP BINARY Failed:', e.message);
  }

  console.log(`--- Testing SLMP ASCII on ${ip}:${port} ---`);
  try {
    const res = await readSlmpRegisters({
      ip,
      port,
      registers: [{ register: 2250, device: 'D' }],
      timeoutMs,
      frameMode: 'ASCII'
    });
    console.log('SLMP ASCII Success:', res);
  } catch (e) {
    console.log('SLMP ASCII Failed:', e.message);
  }

  console.log(`--- Testing Modbus TCP on ${ip}:${port} ---`);
  try {
    const res = await readModbusRegisters({
      ip,
      port,
      registers: [2250],
      timeoutMs
    });
    console.log('Modbus TCP Success:', res);
  } catch (e) {
    console.log('Modbus TCP Failed:', e.message);
  }

  console.log(`--- Testing SLMP Binary on standard port 5000 ---`);
  try {
    const res = await readSlmpRegisters({
      ip,
      port: 5000,
      registers: [{ register: 2250, device: 'D' }],
      timeoutMs,
      frameMode: 'BINARY'
    });
    console.log('SLMP 5000 BINARY Success:', res);
  } catch (e) {
    console.log('SLMP 5000 BINARY Failed:', e.message);
  }

  process.exit(0);
})();
