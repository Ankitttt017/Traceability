const net = require('net');

(async () => {
  const ip = '192.168.119.40';
  const port = 1025;

  console.log(`Probing ${ip}:${port} using TCP_TEXT...`);

  const socket = new net.Socket();
  socket.setTimeout(3000);

  socket.connect(port, ip, () => {
    console.log('[CONNECTED]');
    
    // Let's send a standard TCP_TEXT command
    const cmd = 'START_OPERATION|PART123|OP150\n';
    console.log(`Sending: ${cmd.trim()}`);
    socket.write(cmd);
  });

  socket.on('data', (data) => {
    console.log('[RECEIVED DATA]:', data.toString());
    socket.destroy();
  });

  socket.on('error', (err) => {
    console.log('[ERROR]:', err.message);
  });

  socket.on('timeout', () => {
    console.log('[TIMEOUT]');
    socket.destroy();
  });

  socket.on('close', () => {
    console.log('[CLOSED]');
  });
})();
