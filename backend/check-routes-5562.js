const net = require('net');

const DEVICE_CODES = { D: 0xa8 };

function buildSlmpDeviceSpec(address, device) {
  const buffer = Buffer.alloc(4);
  buffer.writeUIntLE(Math.max(0, Number(address) || 0), 0, 3);
  buffer.writeUInt8(DEVICE_CODES[device] || DEVICE_CODES.D, 3);
  return buffer;
}

function buildSlmpFrame({
  command,
  subcommand,
  data = Buffer.alloc(0),
  monitoringTimer = 0x0010,
  networkNo,
  plcNo,
  ioNo,
  stationNo,
}) {
  const requestDataLength = 2 + 2 + 2 + data.length;
  const frame = Buffer.alloc(9 + requestDataLength);

  frame.writeUInt16LE(0x0050, 0);
  frame.writeUInt8(networkNo, 2);
  frame.writeUInt8(plcNo, 3);
  frame.writeUInt16LE(ioNo, 4);
  frame.writeUInt8(stationNo, 6);
  frame.writeUInt16LE(requestDataLength, 7);
  frame.writeUInt16LE(monitoringTimer, 9);
  frame.writeUInt16LE(command, 11);
  frame.writeUInt16LE(subcommand, 13);
  if (data.length > 0) data.copy(frame, 15);
  return frame;
}

function toLeHexUInt16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value, 0);
  return b.toString('hex').toUpperCase();
}

function toHexByte(value) {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

function toHexUInt16(value) {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

function buildSlmpAsciiFrame({
  command,
  subcommand,
  data = Buffer.alloc(0),
  monitoringTimer = 0x0010,
  networkNo,
  plcNo,
  ioNo,
  stationNo,
}) {
  const payloadHex =
    `${toLeHexUInt16(monitoringTimer)}` +
    `${toLeHexUInt16(command)}` +
    `${toLeHexUInt16(subcommand)}` +
    `${data.toString('hex').toUpperCase()}`;
  const requestDataLength = payloadHex.length;
  const frameText =
    "5000" +
    toHexByte(networkNo) +
    toHexByte(plcNo) +
    toHexUInt16(ioNo) +
    toHexByte(stationNo) +
    toHexUInt16(requestDataLength) +
    payloadHex;
  return Buffer.from(frameText, 'ascii');
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('PLC packet timeout')), timeoutMs))
  ]);
}

async function sendAndReceivePacket(socket, frame, timeoutMs, protocol) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('error', onError);
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (protocol === 'SLMP_BINARY') {
          if (buffer.length < 9) return;
          const payloadLength = buffer.readUInt16LE(7);
          const totalLength = 9 + payloadLength;
          if (buffer.length >= totalLength) {
            cleanup();
            resolve(buffer.subarray(0, totalLength));
          }
        } else if (protocol === 'SLMP_ASCII') {
          const text = buffer.toString('ascii').toUpperCase().replace(/[^0-9A-F]/g, '');
          if (text.length < 18) return;
          const declaredLength = parseInt(text.slice(14, 18), 16);
          if (!Number.isFinite(declaredLength)) return;
          const expectedB = 18 + declaredLength * 2;
          if (text.length >= expectedB) {
            cleanup();
            resolve(buffer);
          }
        }
      };
      socket.on('data', onData);
      socket.on('error', onError);
      socket.write(frame);
    }),
    timeoutMs
  );
}

function parseResponse(packet, frameMode) {
  if (frameMode === 'ASCII') {
    const text = packet.toString('ascii').toUpperCase().replace(/[^0-9A-F]/g, '');
    const endCodeHex = text.slice(18, 22);
    if (endCodeHex !== '0000') {
      throw new Error(`SLMP ASCII end code 0x${endCodeHex}`);
    }
    return Buffer.from(text.slice(22), 'hex');
  } else {
    const endCode = packet.readUInt16LE(9);
    if (endCode !== 0) {
      throw new Error(`SLMP end code 0x${endCode.toString(16)}`);
    }
    return packet.subarray(11);
  }
}

async function testRoute(ip, port, route, frameMode) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.connect(port, ip, async () => {
      try {
        const deviceSpec = buildSlmpDeviceSpec(2250, 'D');
        const points = Buffer.alloc(2);
        points.writeUInt16LE(1, 0);
        const data = Buffer.concat([deviceSpec, points]);

        const frame = frameMode === 'ASCII'
          ? buildSlmpAsciiFrame({ command: 0x0401, subcommand: 0x0000, data, ...route })
          : buildSlmpFrame({ command: 0x0401, subcommand: 0x0000, data, ...route });

        const response = await sendAndReceivePacket(socket, frame, 1500, frameMode === 'ASCII' ? 'SLMP_ASCII' : 'SLMP_BINARY');
        const payload = parseResponse(response, frameMode);
        const val = payload.readUInt16LE(0);
        resolve({ success: true, val });
      } catch (err) {
        resolve({ success: false, error: err.message });
      } finally {
        socket.destroy();
      }
    });

    socket.on('error', (err) => {
      resolve({ success: false, error: `Connect failed: ${err.message}` });
      socket.destroy();
    });
  });
}

(async () => {
  const ip = '192.168.119.40';
  const port = 5562;

  const routes = [
    { networkNo: 0, plcNo: 0xff, ioNo: 0x03ff, stationNo: 0, name: 'Q/L Series Default' },
    { networkNo: 0, plcNo: 0, ioNo: 0x03ff, stationNo: 0, name: 'PlcNo 0' },
    { networkNo: 0, plcNo: 0xff, ioNo: 0, stationNo: 0, name: 'IoNo 0' },
    { networkNo: 0, plcNo: 0xff, ioNo: 0x03d0, stationNo: 0, name: 'iQ-R Default (0x03d0)' },
    { networkNo: 0, plcNo: 0xff, ioNo: 0x03d1, stationNo: 0, name: 'iQ-R Option (0x03d1)' },
    { networkNo: 0, plcNo: 0xff, ioNo: 0x03d2, stationNo: 0, name: 'iQ-R Option (0x03d2)' },
    { networkNo: 1, plcNo: 0xff, ioNo: 0x03ff, stationNo: 0, name: 'NetworkNo 1' },
    { networkNo: 0, plcNo: 1, ioNo: 0x03ff, stationNo: 0, name: 'PlcNo 1' },
    { networkNo: 0, plcNo: 0xff, ioNo: 0x03ff, stationNo: 1, name: 'StationNo 1' },
  ];

  for (const frameMode of ['BINARY', 'ASCII']) {
    console.log(`\n=================== Testing Frame Mode: ${frameMode} ===================`);
    for (const route of routes) {
      const res = await testRoute(ip, port, route, frameMode);
      if (res.success) {
        console.log(`[SUCCESS] Route "${route.name}" (${JSON.stringify(route)}) -> Value: ${res.val}`);
      } else {
        console.log(`[FAILED] Route "${route.name}" (${JSON.stringify(route)}) -> Error: ${res.error}`);
      }
    }
  }

  process.exit(0);
})();
