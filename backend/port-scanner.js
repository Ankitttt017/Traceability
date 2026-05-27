const net = require('net');

async function checkPort(ip, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.connect(port, ip, () => {
      resolve({ open: true });
      socket.destroy();
    });
    socket.on('error', (err) => {
      resolve({ open: false, error: err.message });
      socket.destroy();
    });
    socket.on('timeout', () => {
      resolve({ open: false, error: 'Timeout' });
      socket.destroy();
    });
  });
}

(async () => {
  const ip = '192.168.119.40';
  const ports = [102, 502, 1025, 2000, 5000, 5001, 5002, 5006, 5007, 8501, 9600];
  console.log(`Scanning ports on ${ip}...`);
  for (const port of ports) {
    const res = await checkPort(ip, port);
    console.log(`Port ${port}: ${res.open ? 'OPEN' : 'CLOSED (' + res.error + ')'}`);
  }
  process.exit(0);
})();
