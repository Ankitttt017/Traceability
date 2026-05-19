const net = require("net");
const { acquireSocket, releaseSocket } = require("./plcProtocols/socketPool");

const DEFAULT_TIMEOUT_MS = Math.max(Number(process.env.PLC_IO_TIMEOUT_MS || 2000), 300);
const DEFAULT_WRITE_RETRY_COUNT = Math.max(Number(process.env.PLC_IO_WRITE_RETRY_COUNT || 2), 1);
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

function isTransientPlcError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("ehostunreach") ||
    message.includes("socket hang up") ||
    message.includes("write after end")
  );
}

function isRetryableSlmpAttemptError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) return false;
  // Point 13: Only retry for transient timeout or connection errors
  return (
    message.includes("timeout") ||
    isTransientPlcError(error)
  );
}

// createSocketClient is replaced by acquireSocket from socketPool

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
  // Use only the configured/default route to avoid cascading timeouts.
  // Previous implementation tried 5 route variants × 2 frame modes = 10 combos,
  // each with its own socket timeout, causing 20-40s total delay on failure.
  return [getDefaultSlmpRoute()];
}

function getSlmpFrameModeCandidates(preferredMode) {
  const preferred = normalizeSlmpFrameMode(preferredMode, "AUTO");
  if (preferred === "ASCII") return ["ASCII"];
  if (preferred === "BINARY") return ["BINARY"];
  // If AUTO, try BINARY first then ASCII as fallback
  return ["BINARY", "ASCII"];
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

async function readSlmpWords(socket, { device, address, count, timeoutMs, route, isAlignedWordRead }) {
  const isBitDevice = ["M", "X", "Y", "L", "F", "V", "B"].includes(device);

  if (isBitDevice && !isAlignedWordRead) {
    const alignedStart = Math.floor(address / 16) * 16;
    const alignedEnd = Math.floor((address + count - 1) / 16) * 16;
    const alignedWordCount = (alignedEnd - alignedStart) / 16 + 1;

    const alignedWords = await readSlmpWords(socket, {
      device,
      address: alignedStart,
      count: alignedWordCount,
      timeoutMs,
      route,
      isAlignedWordRead: true,
    });

    const bits = [];
    for (let i = 0; i < count; i++) {
      const bitAddr = address + i;
      const wordAddr = Math.floor(bitAddr / 16) * 16;
      const wordIndex = (wordAddr - alignedStart) / 16;
      const bitOffset = bitAddr % 16;
      const wordValue = alignedWords[wordIndex] || 0;
      bits.push((wordValue >> bitOffset) & 1);
    }
    return bits;
  }

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

async function writeSlmpWords(socket, { device, address, values, timeoutMs, route, isAlignedWordWrite }) {
  const isBitDevice = ["M", "X", "Y", "L", "F", "V", "B"].includes(device);

  if (isBitDevice && !isAlignedWordWrite) {
    const value = values[0] ? 1 : 0;
    const alignedStart = Math.floor(address / 16) * 16;
    const bitOffset = address % 16;

    const alignedWords = await readSlmpWords(socket, {
      device,
      address: alignedStart,
      count: 1,
      timeoutMs,
      route,
      isAlignedWordRead: true,
    });

    let currentWord = alignedWords[0] || 0;

    if (value === 1) {
      currentWord |= (1 << bitOffset);
    } else {
      currentWord &= ~(1 << bitOffset);
    }

    return writeSlmpWords(socket, {
      device,
      address: alignedStart,
      values: [currentWord],
      timeoutMs,
      route,
      isAlignedWordWrite: true,
    });
  }

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
  if (!ip || !port) throw new Error("PLC IP and port are required");

  const registerList = normalizeRegisters(registers);
  if (registerList.length === 0) return { values: {}, errors: [] };

  const lease = await acquireSocket({ ip, port, timeoutMs });
  const socket = lease.socket;
  let transactionId = 0;
  const nextTransactionId = () => {
    transactionId = (transactionId + 1) % 65536 || 1;
    return transactionId;
  };

  const values = {};
  const errors = [];

  try {
    // Sort and group registers for batch reading (Point 7)
    const sorted = [...new Set(registerList.map(Number))].sort((a, b) => a - b);
    let i = 0;
    while (i < sorted.length) {
      const start = sorted[i];
      let end = start;
      let j = i + 1;
      // Modbus typically allows 125 registers max in one read command
      while (j < sorted.length && sorted[j] - start < 120 && (sorted[j] - end) < 10) {
        end = sorted[j];
        j++;
      }
      const count = end - start + 1;
      const protocolRegister = normalizeModbusRegisterAddress(start);
      
      try {
        const frame = buildReadHoldingFrame(nextTransactionId(), Number(unitId || 1), protocolRegister, count);
        const packet = await sendAndReceivePacket(socket, frame, timeoutMs);
        const batchValues = parseModbusReadResponse(packet);
        
        for (let k = i; k < j; k++) {
          const reg = sorted[k];
          const offset = reg - start;
          if (offset < batchValues.length) {
            values[reg] = batchValues[offset];
          }
        }
      } catch (error) {
        try {
          socket.destroy();
        } catch (_) {}
        for (let k = i; k < j; k++) {
          errors.push({ register: sorted[k], message: error.message });
        }
      }
      i = j;
    }
  } finally {
    releaseSocket(lease);
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
  retryCount = DEFAULT_WRITE_RETRY_COUNT,
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

  const attempts = Math.max(Number(retryCount || 1), 1);
  const protocolRegister = normalizeModbusRegisterAddress(registerNo);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const lease = await acquireSocket({ ip, port, timeoutMs });
    const socket = lease.socket;
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
        protocolRegister,
        Math.trunc(registerValue)
      );
      const packet = await sendAndReceivePacket(socket, frame, timeoutMs);
      parseModbusWriteResponse(packet);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      try {
        socket.destroy();
      } catch (_) {}
      if (attempt >= attempts || !isTransientPlcError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(150 * attempt, 500)));
    } finally {
        releaseSocket(lease);
    }
  }
  if (lastError) {
    throw lastError;
  }

  return {
    register: Math.trunc(registerNo),
    protocolRegister: Math.trunc(protocolRegister),
    unitId: Number(unitId || 1),
    value: Math.trunc(registerValue),
  };
}

async function probeTcpEndpoint({ ip, port, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!ip || !port) {
    throw new Error("PLC IP and port are required");
  }
  const lease = await acquireSocket({ ip, port, timeoutMs });
  const socket = lease.socket;
  try {
    return { connected: true };
  } finally {
      releaseSocket(lease);
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
  // Use bounded per-operation timeouts to prevent cascading delays
  const perAttemptTimeoutMs = Math.min(Math.max(timeoutMs, 300), 2000);
  // Overall deadline to prevent total time from exceeding caller's expectations
  const overallDeadline = Date.now() + Math.max(timeoutMs * 2, 6000);
  let lastError = null;
  for (const frameMode of frameModes) {
    // Check overall deadline before each frame mode attempt
    if (Date.now() >= overallDeadline) break;
    for (const route of routes) {
      // Check overall deadline before each route attempt
      if (Date.now() >= overallDeadline) break;
      const remainingMs = Math.max(overallDeadline - Date.now(), 500);
      const connectTimeoutMs = Math.min(perAttemptTimeoutMs, remainingMs);
      const lease = await acquireSocket({ ip, port, timeoutMs: connectTimeoutMs });
      const socket = lease.socket;
      const values = {};
      const errors = [];
      try {
        const probeRow = unique[0];
        // Fast route probe: if one register times out on this frame/route combo, skip quickly.
        await readSlmpWords(socket, {
          device: probeRow.device,
          address: probeRow.register,
          count: 1,
          timeoutMs: Math.min(perAttemptTimeoutMs, Math.max(overallDeadline - Date.now(), 300)),
          route: { ...route, frameMode },
        });

        // Sort and group registers for batch reading (Point 7)
        const deviceGroups = {};
        for (const row of unique) {
          if (!deviceGroups[row.device]) deviceGroups[row.device] = [];
          deviceGroups[row.device].push(row.register);
        }

        for (const device in deviceGroups) {
          const sorted = deviceGroups[device].sort((a, b) => a - b);
          let i = 0;
          while (i < sorted.length) {
            const start = sorted[i];
            let end = start;
            let j = i + 1;
            // Batch contiguous registers (gap up to 10 allowed for SLMP efficiency)
            while (j < sorted.length && sorted[j] - start < 100 && (sorted[j] - end) < 10) {
              end = sorted[j];
              j++;
            }
            const count = end - start + 1;

            if (Date.now() >= overallDeadline) {
              for (let k = i; k < j; k++) {
                errors.push({ register: sorted[k], device, frameMode, message: "Deadline exceeded" });
              }
              i = j;
              continue;
            }

            try {
              const batchValues = await readSlmpWords(socket, {
                device,
                address: start,
                count,
                timeoutMs: Math.min(perAttemptTimeoutMs, Math.max(overallDeadline - Date.now(), 300)),
                route: { ...route, frameMode },
              });
              
              // Map batch results back to individual registers
              for (let k = i; k < j; k++) {
                const reg = sorted[k];
                const offset = reg - start;
                if (offset < batchValues.length) {
                  values[reg] = batchValues[offset];
                }
              }
            } catch (error) {
              for (let k = i; k < j; k++) {
                errors.push({
                  register: sorted[k],
                  device,
                  frameMode,
                  message: String(error.message || "Read failed"),
                });
              }
            }
            i = j;
          }
        }
        // If we got at least one value, treat route/mode as valid and return.
        if (Object.keys(values).length > 0 || errors.length === 0) {
          if (Object.keys(values).length === 0 && errors.length > 0) {
            try {
              socket.destroy();
            } catch (_) {}
          }
          return { values, errors };
        }
        try {
          socket.destroy();
        } catch (_) {}
        lastError = new Error(errors[0]?.message || "SLMP read failed");
        if (!isRetryableSlmpAttemptError(lastError)) return { values, errors };
      } catch (error) {
        lastError = error;
        try {
          socket.destroy();
        } catch (_) {}
        if (!isRetryableSlmpAttemptError(error)) throw error;
      } finally {
          releaseSocket(lease);
      }
    }
  }
  const routeDesc = routes.map(describeRoute).join(" | ");
  const modeDesc = frameModes.map(describeSlmpFrameMode).join(",");
  const timeoutIndicator = String(lastError?.message || "").toLowerCase().includes("timeout") 
    ? " — No PLC response. Verify: (1) Port 5000/5006 is correct for SLMP, (2) PLC service enabled, (3) Firewall allows access"
    : " — PLC rejected request. Check: (1) Frame mode (BINARY/ASCII), (2) Route params, (3) Unit ID";
  throw new Error(
    `Register read failed: ${String(lastError?.message || "PLC packet timeout")}${timeoutIndicator}`
  );
}

async function writeSlmpRegister({
  ip,
  port,
  register,
  value,
  device = "D",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  frameMode,
  retryCount = DEFAULT_WRITE_RETRY_COUNT,
}) {
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
  const attempts = Math.max(Number(retryCount || 1), 1);
  // Overall deadline: prevent total cascading time from exceeding expectations
  const overallDeadline = Date.now() + Math.max(timeoutMs * attempts * 2, 8000);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (Date.now() >= overallDeadline) break;
    for (const mode of frameModes) {
      if (Date.now() >= overallDeadline) break;
      for (const route of routes) {
        if (Date.now() >= overallDeadline) break;
        const remainingMs = Math.max(overallDeadline - Date.now(), 500);
        const connectTimeoutMs = Math.min(timeoutMs, remainingMs);
        const lease = await acquireSocket({ ip, port, timeoutMs: connectTimeoutMs });
        const socket = lease.socket;
        try {
          await writeSlmpWords(socket, {
            device: slmpDevice,
            address: Math.trunc(registerNo),
            values: [Math.trunc(registerValue)],
            timeoutMs: Math.min(timeoutMs, Math.max(overallDeadline - Date.now(), 500)),
            route: { ...route, frameMode: mode },
          });
          usedRoute = route;
          usedFrameMode = mode;
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          try {
            socket.destroy();
          } catch (_) {}
          if (!isRetryableSlmpAttemptError(error)) throw error;
        } finally {
            releaseSocket(lease);
        }
      }
      if (usedRoute) break;
    }
    if (usedRoute) break;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(150 * attempt, 500)));
    }
  }
  if (!usedRoute) {
    const routeDesc = routes.map(describeRoute).join(" | ");
    const modeDesc = frameModes.map(describeSlmpFrameMode).join(",");
    const timeoutIndicator = String(lastError?.message || "").toLowerCase().includes("timeout") 
      ? " — No PLC response. Verify: (1) Port 5000/5006 is correct for SLMP, (2) PLC service enabled, (3) Firewall allows access"
      : " — PLC rejected request. Check: (1) Frame mode (BINARY/ASCII), (2) Route params, (3) Unit ID";
    throw new Error(
      `Register write failed: ${String(lastError?.message || "PLC packet timeout")}${timeoutIndicator}`
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
