const net = require("net");

let tcpServer = null;
let running = false;

function getTcpPort() {
  const parsed = Number(process.env.TCP_SERVER_PORT || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function startTcpServer() {
  if (running) {
    return;
  }

  const port = getTcpPort();
  if (!port) {
    console.log("[TCP] TCP server disabled (set TCP_SERVER_PORT to enable).");
    running = true;
    return;
  }

  tcpServer = net.createServer((socket) => {
    socket.on("error", (error) => {
      console.error("[TCP] Client socket error:", error.message);
    });
  });

  tcpServer.on("error", (error) => {
    console.error("[TCP] Server error:", error.message);
  });

  tcpServer.listen(port, () => {
    console.log(`[TCP] Server listening on port ${port}`);
  });

  running = true;
}

function shutdownTcpServer() {
  return new Promise((resolve) => {
    if (!tcpServer) {
      running = false;
      resolve();
      return;
    }

    tcpServer.close(() => {
      running = false;
      tcpServer = null;
      resolve();
    });
  });
}

module.exports = {
  startTcpServer,
  shutdownTcpServer,
};
