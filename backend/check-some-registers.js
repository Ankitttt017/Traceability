const { readSlmpRegisters } = require('./services/plcIoService');

(async () => {
  const ip = '192.168.119.40';
  const port = 1025;
  const timeoutMs = 2000;

  const registersToTest = [
    { register: 0, device: 'D', name: 'D0' },
    { register: 101, device: 'D', name: 'D101' },
    { register: 110, device: 'D', name: 'D110' },
    { register: 2250, device: 'D', name: 'D2250' },
    { register: 6010, device: 'D', name: 'D6010' },
    { register: 100, device: 'M', name: 'M100' },
    { register: 110, device: 'M', name: 'M110' }
  ];

  for (const reg of registersToTest) {
    console.log(`--- Testing register ${reg.name} ---`);
    try {
      const res = await readSlmpRegisters({
        ip,
        port,
        registers: [{ register: reg.register, device: reg.device }],
        timeoutMs,
        frameMode: 'BINARY'
      });
      console.log(`[SUCCESS] ${reg.name} ->`, res.values);
    } catch (e) {
      console.log(`[FAILED] ${reg.name} ->`, e.message);
    }
  }

  process.exit(0);
})();
