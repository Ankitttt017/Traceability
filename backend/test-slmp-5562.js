const { readSlmpRegisters } = require('./services/plcIoService');

(async () => {
  const ip = '192.168.119.40';
  const port = 5562;
  const registers = [0, 101, 2250, 6010];

  console.log(`Testing SLMP on ${ip}:${port}...`);
  try {
    const res = await readSlmpRegisters({
      ip,
      port,
      registers,
      timeoutMs: 3000
    });
    console.log('[SUCCESS] SLMP Read Result ->', res);
  } catch (e) {
    console.log('[FAILED] SLMP Read ->', e.message);
  }

  process.exit(0);
})();
