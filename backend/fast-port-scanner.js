const net = require('net');

async function checkPort(ip, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.connect(port, ip, () => {
      resolve(true);
      socket.destroy();
    });
    socket.on('error', () => {
      resolve(false);
      socket.destroy();
    });
    socket.on('timeout', () => {
      resolve(false);
      socket.destroy();
    });
  });
}

(async () => {
  const ip = '192.168.119.40';
  const concurrency = 200;
  const startPort = 1;
  const endPort = 10000;

  console.log(`🚀 Starting fast concurrent port scan on ${ip} from port ${startPort} to ${endPort}...`);
  const openPorts = [];

  for (let i = startPort; i <= endPort; i += concurrency) {
    const batch = [];
    for (let j = 0; j < concurrency && (i + j) <= endPort; j++) {
      const port = i + j;
      batch.push(
        checkPort(ip, port).then((isOpen) => {
          if (isOpen) {
            console.log(`[FOUND] Port ${port} is OPEN!`);
            openPorts.push(port);
          }
        })
      );
    }
    await Promise.all(batch);
  }

  console.log(`\n=== SCAN COMPLETED ===`);
  console.log(`Open ports found:`, openPorts);
  process.exit(0);
})();
