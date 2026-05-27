const net = require('net');

// Mock PLC Server (TCP Text)
const server = net.createServer((socket) => {
  console.log('PLC: Backend connected');
  socket.on('data', (data) => {
    const msg = data.toString().trim();
    console.log(`PLC RECEIVED: ${msg}`);
    
    if (msg.startsWith('START_OPERATION')) {
      const partId = msg.split('|')[1];
      // Echo back success
      setTimeout(() => socket.write(`ACK_START|${partId}\n`), 100);
      setTimeout(() => socket.write(`ACK_END_OK|${partId}\n`), 500);
    }
  });
});

server.listen(5021, '0.0.0.0', () => {
  console.log('🤖 Mock PLC (TCP Text) running on port 5021');
});
