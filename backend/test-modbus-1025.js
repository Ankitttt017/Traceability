const { readModbusRegisters } = require('./services/plcIoService');

(async () => {
  const ip = '192.168.119.40';
  const port = 1025;
  const timeoutMs = 2000;

  console.log(`Testing Modbus TCP on ${ip}:${port}...`);
  try {
    const res = await readModbusRegisters({
      ip,
      port,
      unitId: 1,
      registers: [1, 2, 101, 2250],
      timeoutMs
    });
    console.log('[SUCCESS] Modbus TCP ->', res);
  } catch (e) {
    console.log('[FAILED] Modbus TCP ->', e.message);
  }

  process.exit(0);
})();
