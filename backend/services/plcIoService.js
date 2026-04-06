const net = require("net");

const DEFAULT_TIMEOUT_MS = Math.max(Number(process.env.PLC_IO_TIMEOUT_MS || 2000), 300);
const DEFAULT_SLMP_FRAME_MODE = String(process.env.PLC_SLMP_FRAME_MODE || "AUTO")
  .trim()
  .toUpperCase();
const DEVICE_CODES = {
  D: 0xa8,
  M: 0x90,
  X: 0x9c,
  Y: 0x9d,
  W: 0xb4,
  L: 0x92,
  F: 0x93,
  V: 0x94,
  B: 0xa0,
  R: 0xaf,
};

function normalizeModbusRegisterAddress(register) {
  const n = Number(register);
  if (!Number.isFinite(n)) return n;
  const raw = Math.trunc(n);
  // Support common human notation:
  // 40001..49999 -> holding register offsets 0..9998
  // 400001..465536 -> extended holding register notation
  if (raw >= 40001 && raw <= 49999) return raw - 40001;
  if (raw >= 400001 && raw <= 465536) return raw - 400001;
  return raw;
}

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

function normalizeSlmpDevice(value, fallback = "D") {
  const key = String(value || "").trim().toUpperCase();
  return DEVICE_CODES[key] ? key : fallback;
}

function normalizeSlmpFrameMode(value, fallback = "AUTO") {
  const mode = String(value || "").trim().toUpperCase();
  if (mode === "ASCII" || mode === "BINARY" || mode === "AUTO") return mode;
  return fallback;
}

function toByte(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 0), 255);
}

function toUInt16(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 0), 0xffff);
}

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
  const def = getDefaultSlmpRoute();
  const resolvedNetworkNo = toByte(networkNo ?? def.networkNo);
  const resolvedPlcNo = toByte(plcNo ?? def.plcNo);
  const resolvedIoNo = toUInt16(ioNo ?? def.ioNo);
  const resolvedStationNo = toByte(stationNo ?? def.stationNo);
  const requestDataLength = 2 + 2 + 2 + data.length;
  const frame = Buffer.alloc(9 + requestDataLength);

  frame.writeUInt16LE(0x0050, 0);
  frame.writeUInt8(resolvedNetworkNo, 2);
  frame.writeUInt8(resolvedPlcNo, 3);
  frame.writeUInt16LE(resolvedIoNo, 4);
  frame.writeUInt8(resolvedStationNo, 6);
  frame.writeUInt16LE(requestDataLength, 7);
  frame.writeUInt16LE(toUInt16(monitoringTimer), 9);
  frame.writeUInt16LE(command, 11);
  frame.writeUInt16LE(subcommand, 13);
  if (data.length > 0) data.copy(frame, 15);
  return frame;
}

function toHexByte(value) {
  return toByte(value).toString(16).toUpperCase().padStart(2, "0");
}

function toHexUInt16(value) {
  return toUInt16(value).toString(16).toUpperCase().padStart(4, "0");
}

function toLeHexUInt16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(toUInt16(value), 0);
  return b.toString("hex").toUpperCase();
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
  const def = getDefaultSlmpRoute();
  const resolvedNetworkNo = toByte(networkNo ?? def.networkNo);
  const resolvedPlcNo = toByte(plcNo ?? def.plcNo);
  const resolvedIoNo = toUInt16(ioNo ?? def.ioNo);
  const resolvedStationNo = toByte(stationNo ?? def.stationNo);

  const payloadHex =
    `${toLeHexUInt16(monitoringTimer)}` +
    `${toLeHexUInt16(command)}` +
    `${toLeHexUInt16(subcommand)}` +
    `${data.toString("hex").toUpperCase()}`;
  const requestDataLength = payloadHex.length;
  const frameText =
    "5000" +
    toHexByte(resolvedNetworkNo) +
    toHexByte(resolvedPlcNo) +
    toHexUInt16(resolvedIoNo) +
    toHexByte(resolvedStationNo) +
    toHexUInt16(requestDataLength) +
    payloadHex;
  return Buffer.from(frameText, "ascii");
}

function getDefaultSlmpRoute() {
  return {
    networkNo: toByte(process.env.PLC_SLMP_NETWORK_NO || 0),
    plcNo: toByte(process.env.PLC_SLMP_PLC_NO || 0xff),
    ioNo: toUInt16(process.env.PLC_SLMP_IO_NO || 0x03ff),
    stationNo: toByte(process.env.PLC_SLMP_STATION_NO || 0),
  };
}

function routeKey(route) {
  return `${route.networkNo}-${route.plcNo}-${route.ioNo}-${route.stationNo}`;
}

function describeRoute(route) {
  return `net=${route.networkNo},plc=${route.plcNo},io=${route.ioNo},station=${route.stationNo}`;
}

function getSlmpRouteCandidates() {
  const base = getDefaultSlmpRoute();
  // Keep a small prioritized list to avoid very long timeout cascades.
  const candidates = [
    base,
    { ...base, plcNo: base.plcNo === 0xff ? 0 : 0xff },
    { ...base, ioNo: base.ioNo === 0x03ff ? 0 : 0x03ff },
    { ...base, stationNo: base.stationNo === 0 ? 1 : 0 },
    {
      networkNo: base.networkNo === 0 ? 1 : 0,
      plcNo: base.plcNo === 0xff ? 0 : 0xff,
      ioNo: base.ioNo === 0x03ff ? 0 : 0x03ff,
      stationNo: base.stationNo === 0 ? 1 : 0,
    },
  ];

  const dedup = [];
  const seen = new Set();
  for (const route of candidates) {
    const key = routeKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(route);
  }
  return dedup;
}

function getSlmpFrameModeCandidates(preferredMode) {
  const preferred = normalizeSlmpFrameMode(preferredMode, normalizeSlmpFrameMode(DEFAULT_SLMP_FRAME_MODE, "AUTO"));
  if (preferred === "ASCII") return ["ASCII", "BINARY"];
  if (preferred === "BINARY") return ["BINARY", "ASCII"];
  return ["ASCII", "BINARY"];
}

function describeSlmpFrameMode(mode) {
  return normalizeSlmpFrameMode(mode, "AUTO");
}

function parseSlmpAsciiPacket(packet) {
  const text = packet
    .toString("ascii")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
  if (text.length < 22) throw new Error("Invalid SLMP ASCII response length");
  if (!/^[0-9A-F]+$/.test(text)) throw new Error("Invalid SLMP ASCII response characters");
  const declaredLength = parseInt(text.slice(14, 18), 16);
  if (!Number.isFinite(declaredLength)) throw new Error("Invalid SLMP ASCII payload length");

  const payloadStart = 18;
  const candidates = [declaredLength * 2, declaredLength].filter((len) => len >= 4);
  const payloadLength = candidates.find((len) => text.length >= payloadStart + len);
  if (!payloadLength) throw new Error("Incomplete SLMP ASCII response payload");

  const payloadHex = text.slice(payloadStart, payloadStart + payloadLength);
  if (payloadHex.length < 4) throw new Error("Invalid SLMP ASCII response payload");
  const endCodeHex = payloadHex.slice(0, 4);
  const endCodeLE = parseInt(`${endCodeHex.slice(2, 4)}${endCodeHex.slice(0, 2)}`, 16);
  const endCodeBE = parseInt(endCodeHex, 16);
  const success = endCodeLE === 0x0000 || endCodeBE === 0x0000;
  if (!success) {
    const code = Number.isFinite(endCodeLE) ? endCodeLE : endCodeBE;
    throw new Error(`SLMP end code 0x${String(code || 0).toString(16).padStart(4, "0")}`);
  }

  const dataHex = payloadHex.slice(4);
  if (dataHex.length % 2 !== 0) throw new Error("Invalid SLMP ASCII data length");
  return Buffer.from(dataHex, "hex");
}

function parseSlmpResponse(packet, frameMode = "BINARY") {
  const mode = normalizeSlmpFrameMode(frameMode, "BINARY");
  if (mode === "ASCII") {
    return parseSlmpAsciiPacket(packet);
  }
  if (packet.length < 11) throw new Error("Invalid SLMP response length");
  const payloadLength = packet.readUInt16LE(7);
  const endCodeOffset = 9;
  if (packet.length < endCodeOffset + 2) throw new Error("Invalid SLMP response payload");
  const endCode = packet.readUInt16LE(endCodeOffset);
  if (endCode !== 0x0000) {
    throw new Error(`SLMP end code 0x${endCode.toString(16).padStart(4, "0")}`);
  }
  const dataOffset = endCodeOffset + 2;
  const dataLength = Math.max(0, payloadLength - 2);
  return packet.subarray(dataOffset, dataOffset + dataLength);
}

async function readSlmpWords(socket, { device, address, count, timeoutMs, route }) {
  const deviceSpec = buildSlmpDeviceSpec(address, device);
  const points = Buffer.alloc(2);
  points.writeUInt16LE(count, 0);
  const data = Buffer.concat([deviceSpec, points]);
  const frameMode = normalizeSlmpFrameMode(route?.frameMode, "BINARY");
  const frame =
    frameMode === "ASCII"
      ? buildSlmpAsciiFrame({ command: 0x0401, subcommand: 0x0000, data, ...route })
      : buildSlmpFrame({ command: 0x0401, subcommand: 0x0000, data, ...route });
  const packet = await sendAndReceivePacket(socket, frame, timeoutMs, {
    protocol: frameMode === "ASCII" ? "SLMP_ASCII" : "SLMP_BINARY",
  });
  const payload = parseSlmpResponse(packet, frameMode);
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const offset = i * 2;
    if (offset + 2 <= payload.length) values.push(payload.readUInt16LE(offset));
  }
  return values;
}

async function writeSlmpWords(socket, { device, address, values, timeoutMs, route }) {
  const deviceSpec = buildSlmpDeviceSpec(address, device);
  const points = Buffer.alloc(2);
  points.writeUInt16LE(values.length, 0);
  const dataWords = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => {
    dataWords.writeUInt16LE((Number(value) || 0) & 0xffff, index * 2);
  });
  const data = Buffer.concat([deviceSpec, points, dataWords]);
  const frameMode = normalizeSlmpFrameMode(route?.frameMode, "BINARY");
  const frame =
    frameMode === "ASCII"
      ? buildSlmpAsciiFrame({ command: 0x1401, subcommand: 0x0000, data, ...route })
      : buildSlmpFrame({ command: 0x1401, subcommand: 0x0000, data, ...route });
  const packet = await sendAndReceivePacket(socket, frame, timeoutMs, {
    protocol: frameMode === "ASCII" ? "SLMP_ASCII" : "SLMP_BINARY",
  });
  parseSlmpResponse(packet, frameMode);
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

async function sendAndReceivePacket(socket, frame, timeoutMs, options = {}) {
  const protocol = String(options.protocol || "MODBUS").toUpperCase();
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
        if (protocol === "MODBUS") {
          if (buffer.length < 6) return;
          const length = buffer.readUInt16BE(4);
          const totalLength = 6 + length;
          if (buffer.length >= totalLength) {
            cleanup();
            resolve(buffer.subarray(0, totalLength));
          }
          return;
        }

        if (protocol === "SLMP_BINARY") {
          if (buffer.length < 9) return;
          const payloadLength = buffer.readUInt16LE(7);
          const totalLength = 9 + payloadLength;
          if (buffer.length >= totalLength) {
            cleanup();
            resolve(buffer.subarray(0, totalLength));
          }
          return;
        }

        if (protocol === "SLMP_ASCII") {
          const text = buffer
            .toString("ascii")
            .toUpperCase()
            .replace(/[^0-9A-F]/g, "");
          if (text.length < 18) return;
          const declaredLength = parseInt(text.slice(14, 18), 16);
          if (!Number.isFinite(declaredLength)) return;
          const expectedA = 18 + declaredLength;
          const expectedB = 18 + declaredLength * 2;
          if (text.length >= expectedB) {
            cleanup();
            resolve(buffer);
            return;
          }
          if (text.length >= expectedA) {
            cleanup();
            resolve(buffer);
          }
          return;
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
        const protocolRegister = normalizeModbusRegisterAddress(registerNo);
        const frame = buildReadHoldingFrame(nextTransactionId(), Number(unitId || 1), protocolRegister, 1);
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
    const protocolRegister = normalizeModbusRegisterAddress(registerNo);
    const frame = buildWriteSingleRegisterFrame(
      nextTransactionId(),
      Number(unitId || 1),
      protocolRegister,
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

async function readSlmpRegisters({
  ip,
  port,
  registers = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  defaultDevice = "D",
  frameMode,
}) {
  if (!ip || !port) throw new Error("PLC IP and port are required");
  const source = Array.isArray(registers) ? registers : [];
  const normalized = source
    .map((entry) => {
      const isObj = entry && typeof entry === "object";
      const register = Number(isObj ? entry.register ?? entry.address : entry);
      if (!Number.isFinite(register) || register < 0) return null;
      return {
        register: Math.trunc(register),
        device: normalizeSlmpDevice(isObj ? entry.device : defaultDevice, normalizeSlmpDevice(defaultDevice, "D")),
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) return { values: {}, errors: [] };

  const unique = [];
  const seen = new Set();
  for (const row of normalized) {
    const key = `${row.device}:${row.register}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const routes = getSlmpRouteCandidates();
  const frameModes = getSlmpFrameModeCandidates(frameMode);
  const routeProbeTimeoutMs = Math.min(Math.max(timeoutMs, 300), 900);
  const registerReadTimeoutMs = Math.min(Math.max(timeoutMs, 300), 1200);
  let lastError = null;
  for (const frameMode of frameModes) {
    for (const route of routes) {
      const socket = await createSocketClient({ ip, port, timeoutMs });
      const values = {};
      const errors = [];
      try {
        const probeRow = unique[0];
        // Fast route probe: if one register times out on this frame/route combo, skip quickly.
        await readSlmpWords(socket, {
          device: probeRow.device,
          address: probeRow.register,
          count: 1,
          timeoutMs: routeProbeTimeoutMs,
          route: { ...route, frameMode },
        });

        for (const row of unique) {
          try {
            const out = await readSlmpWords(socket, {
              device: row.device,
              address: row.register,
              count: 1,
              timeoutMs: registerReadTimeoutMs,
              route: { ...route, frameMode },
            });
            values[row.register] = out[0];
          } catch (error) {
            errors.push({
              register: row.register,
              device: row.device,
              frameMode,
              message: String(error.message || "Read failed"),
            });
          }
        }
        // If we got at least one value, treat route/mode as valid and return.
        if (Object.keys(values).length > 0 || errors.length === 0) return { values, errors };
        lastError = new Error(errors[0]?.message || "SLMP read failed");
        const isTimeout = /timeout|invalid slmp/i.test(String(lastError.message || ""));
        if (!isTimeout) return { values, errors };
      } catch (error) {
        lastError = error;
        const isTimeout = /timeout|invalid slmp/i.test(String(error.message || ""));
        if (!isTimeout) throw error;
      } finally {
        try {
          socket.destroy();
        } catch (_error) {
          // noop
        }
      }
    }
  }
  const routeDesc = routes.map(describeRoute).join(" | ");
  const modeDesc = frameModes.map(describeSlmpFrameMode).join(",");
  throw new Error(
    `${String(lastError?.message || "PLC packet timeout")} (tried SLMP frames: ${modeDesc}; routes: ${routeDesc})`
  );
}

async function writeSlmpRegister({ ip, port, register, value, device = "D", timeoutMs = DEFAULT_TIMEOUT_MS, frameMode }) {
  const registerNo = Number(register);
  const registerValue = Number(value);
  if (!ip || !port) throw new Error("PLC IP and port are required");
  if (!Number.isFinite(registerNo) || registerNo < 0) throw new Error("Valid register number is required");
  if (!Number.isFinite(registerValue)) throw new Error("Valid register value is required");

  const slmpDevice = normalizeSlmpDevice(device, "D");
  const routes = getSlmpRouteCandidates();
  const frameModes = getSlmpFrameModeCandidates(frameMode);
  let lastError = null;
  let usedRoute = null;
  let usedFrameMode = null;
  for (const mode of frameModes) {
    for (const route of routes) {
      const socket = await createSocketClient({ ip, port, timeoutMs });
      try {
        await writeSlmpWords(socket, {
          device: slmpDevice,
          address: Math.trunc(registerNo),
          values: [Math.trunc(registerValue)],
          timeoutMs,
          route: { ...route, frameMode: mode },
        });
        usedRoute = route;
        usedFrameMode = mode;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const isTimeout = /timeout|invalid slmp/i.test(String(error.message || ""));
        if (!isTimeout) throw error;
      } finally {
        try {
          socket.destroy();
        } catch (_error) {
          // noop
        }
      }
    }
    if (usedRoute) break;
  }
  if (!usedRoute) {
    const routeDesc = routes.map(describeRoute).join(" | ");
    const modeDesc = frameModes.map(describeSlmpFrameMode).join(",");
    throw new Error(
      `${String(lastError?.message || "PLC packet timeout")} (tried SLMP frames: ${modeDesc}; routes: ${routeDesc})`
    );
  }

  return {
    device: slmpDevice,
    register: Math.trunc(registerNo),
    value: Math.trunc(registerValue),
    frameMode: usedFrameMode,
    route: describeRoute(usedRoute),
  };
}

module.exports = {
  readModbusRegisters,
  writeModbusRegister,
  readSlmpRegisters,
  writeSlmpRegister,
  probeTcpEndpoint,
};
