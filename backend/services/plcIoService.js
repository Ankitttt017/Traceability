const net = require("net");

const DEFAULT_TIMEOUT_MS = Math.max(Number(process.env.PLC_IO_TIMEOUT_MS || 2000), 300);

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

function createSocketClient({ ip, port, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (handler) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      handler(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("error", done((error) => reject(error)));
    socket.once("timeout", done(() => reject(new Error("PLC connect timeout"))));
    socket.connect(
      Number(port),
      ip,
      done(() => {
        socket.setTimeout(0);
        resolve(socket);
      })
    );
  });
}

function buildReadHoldingFrame(transactionId, unitId, register, quantity) {
  const frame = Buffer.alloc(12);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(6, 4);
  frame.writeUInt8(unitId, 6);
  frame.writeUInt8(0x03, 7);
  frame.writeUInt16BE(register, 8);
  frame.writeUInt16BE(quantity, 10);
  return frame;
}

function buildWriteSingleRegisterFrame(transactionId, unitId, register, value) {
  const frame = Buffer.alloc(12);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(6, 4);
  frame.writeUInt8(unitId, 6);
  frame.writeUInt8(0x06, 7);
  frame.writeUInt16BE(register, 8);
  frame.writeUInt16BE(value & 0xffff, 10);
  return frame;
}

function parseModbusReadResponse(packet) {
  if (packet.length < 9) {
    throw new Error("Invalid Modbus read response");
  }
  const functionCode = packet.readUInt8(7);
  if (functionCode === 0x83) {
    const code = packet.readUInt8(8);
    throw new Error(`Modbus exception code ${code}`);
  }
  if (functionCode !== 0x03) {
    throw new Error(`Unexpected Modbus function code ${functionCode}`);
  }
  const byteCount = packet.readUInt8(8);
  if (byteCount < 2 || packet.length < 9 + byteCount) {
    throw new Error("Invalid Modbus byte count");
  }
  return packet.readUInt16BE(9);
}

function parseModbusWriteResponse(packet) {
  if (packet.length < 12) {
    throw new Error("Invalid Modbus write response");
  }
  const functionCode = packet.readUInt8(7);
  if (functionCode === 0x86) {
    const code = packet.readUInt8(8);
    throw new Error(`Modbus exception code ${code}`);
  }
  if (functionCode !== 0x06) {
    throw new Error(`Unexpected Modbus function code ${functionCode}`);
  }
}

function normalizeRegisters(registers = []) {
  return Array.from(
    new Set(
      (Array.isArray(registers) ? registers : [])
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry) && entry >= 0)
        .map((entry) => Math.trunc(entry))
    )
  ).sort((a, b) => a - b);
}

async function sendAndReceivePacket(socket, frame, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);

      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 6) {
          return;
        }
        const length = buffer.readUInt16BE(4);
        const totalLength = 6 + length;
        if (buffer.length >= totalLength) {
          cleanup();
          resolve(buffer.subarray(0, totalLength));
        }
      };

      socket.on("data", onData);
      socket.on("error", onError);
      socket.write(frame);
    }),
    timeoutMs,
    "PLC packet timeout"
  );
}

async function readModbusRegisters({ ip, port, unitId = 1, registers = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!ip || !port) {
    throw new Error("PLC IP and port are required");
  }

  const registerList = normalizeRegisters(registers);
  if (registerList.length === 0) {
    return { values: {}, errors: [] };
  }

  const socket = await createSocketClient({ ip, port, timeoutMs });
  let transactionId = 0;
  const nextTransactionId = () => {
    transactionId += 1;
    if (transactionId > 65535) {
      transactionId = 1;
    }
    return transactionId;
  };

  const values = {};
  const errors = [];

  try {
    for (const registerNo of registerList) {
      try {
        const frame = buildReadHoldingFrame(nextTransactionId(), Number(unitId || 1), registerNo, 1);
        const packet = await sendAndReceivePacket(socket, frame, timeoutMs);
        values[registerNo] = parseModbusReadResponse(packet);
      } catch (error) {
        errors.push({
          register: registerNo,
          message: String(error.message || "Read failed"),
        });
      }
    }
  } finally {
    try {
      socket.destroy();
    } catch (_error) {
      // noop
    }
  }

  return { values, errors };
}

async function writeModbusRegister({
  ip,
  port,
  unitId = 1,
  register,
  value,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const registerNo = Number(register);
  const registerValue = Number(value);
  if (!ip || !port) {
    throw new Error("PLC IP and port are required");
  }
  if (!Number.isFinite(registerNo) || registerNo < 0) {
    throw new Error("Valid register number is required");
  }
  if (!Number.isFinite(registerValue)) {
    throw new Error("Valid register value is required");
  }

  const socket = await createSocketClient({ ip, port, timeoutMs });
  let transactionId = 0;
  const nextTransactionId = () => {
    transactionId += 1;
    if (transactionId > 65535) {
      transactionId = 1;
    }
    return transactionId;
  };

  try {
    const frame = buildWriteSingleRegisterFrame(
      nextTransactionId(),
      Number(unitId || 1),
      Math.trunc(registerNo),
      Math.trunc(registerValue)
    );
    const packet = await sendAndReceivePacket(socket, frame, timeoutMs);
    parseModbusWriteResponse(packet);
  } finally {
    try {
      socket.destroy();
    } catch (_error) {
      // noop
    }
  }

  return {
    register: Math.trunc(registerNo),
    value: Math.trunc(registerValue),
  };
}

async function probeTcpEndpoint({ ip, port, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!ip || !port) {
    throw new Error("PLC IP and port are required");
  }
  const socket = await createSocketClient({ ip, port, timeoutMs });
  try {
    return { connected: true };
  } finally {
    try {
      socket.destroy();
    } catch (_error) {
      // noop
    }
  }
}

module.exports = {
  readModbusRegisters,
  writeModbusRegister,
  probeTcpEndpoint,
};
