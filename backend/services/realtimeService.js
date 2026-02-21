let ioRef = null;

function setSocketServer(io) {
  ioRef = io;
}

function emitRealtime(event, payload) {
  if (!ioRef) {
    return;
  }
  ioRef.emit(event, payload);
}

module.exports = {
  setSocketServer,
  emitRealtime,
};
